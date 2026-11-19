import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("activation", Path(__file__).with_name("production-time.py"))
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


def fixture():
    return {
        "baseline": activation.SERVICE + "-00001-test", "company": "30", "actor": "50", "parent": "70",
        "slug": "test-fixture", "operator": "fictional-staff", "floor": "2026-01-01",
        "expires": "2099-01-01T00:00:00.000Z", "version": "7", "digest": "a" * 64,
        "scope_approved": True, "work_orders": {"71": "91"}, "cutoff": "2026-11-19T15:00:00.000Z",
        "image": f"{activation.REGION}-docker.pkg.dev/{activation.PROJECT}/mi-client-build/test@sha256:" + "b" * 64,
    }


class ActivationTests(unittest.TestCase):
    def test_database_proof_uses_exact_named_target_and_rejects_wrong_uid(self):
        info = {"name": activation.DATABASE, "uid": "wrong", "locationId": activation.REGION,
                "type": "FIRESTORE_NATIVE", "databaseEdition": "STANDARD"}
        with patch.object(activation, "cloud", return_value=info) as gcloud:
            with self.assertRaisesRegex(activation.Stop, "UID mismatch"):
                activation.database()
            gcloud.assert_called_once_with("firestore", "databases", "describe", "--database=mi-client-production")

    def test_token_only_in_stdin_and_exact_payload_digest(self):
        s = fixture()
        del s["version"]
        del s["digest"]
        fixture_token = "fixture-only-credential"
        with patch.object(activation, "approve") as approve, \
                patch.object(activation.getpass, "getpass", return_value=fixture_token), \
                patch.object(activation, "secret", side_effect=[
                    [{"name": "projects/123/locations/test/secrets/" + activation.SECRET}],
                    {"name": "projects/123/locations/test/secrets/" + activation.SECRET + "/versions/2"},
                ]) as secret, patch("sys.stdout", new_callable=io.StringIO) as stdout:
            activation.pin(s)
        approve.assert_called_once_with("credential")
        args, kwargs = secret.call_args
        self.assertEqual(args, ("versions", "add", activation.SECRET, "--data-file=-"))
        payload = kwargs["payload"]
        self.assertEqual(json.loads(payload), {
            "environment": "production", "databaseUid": activation.UID, "modifiedFrom": s["floor"],
            "tenant": activation.TENANT, "companyId": s["company"], "userId": s["actor"],
            "customerParentId": s["parent"], "clientUrl": s["slug"], "expiresAt": s["expires"],
            "accessToken": fixture_token,
        })
        self.assertEqual(s["digest"], activation.hashlib.sha256(payload).hexdigest())
        self.assertEqual(s["version"], "2")
        self.assertNotIn(fixture_token, str(s) + stdout.getvalue() + str(args))

    def test_worker_pins_time_config_and_rejects_retry_or_identity_drift(self):
        s = fixture()
        c = {"image": s["image"], "command": ["node"], "args": ["dist-server/operator.mjs", "sync-time-customer", activation.TENANT],
             "env": [{"name": k, "value": v} for k, v in {**activation.BASE, **activation.time_env(s)}.items()]}
        task = {"containers": [c], "serviceAccountName": activation.SA, "timeoutSeconds": "1800", "maxRetries": 0}
        job = {"spec": {"template": {"spec": {"taskCount": 1, "parallelism": 1, "template": {"spec": task}}}}}
        activation.validate_job(job, s)
        task["maxRetries"] = 2
        with self.assertRaises(activation.Stop):
            activation.validate_job(job, s)
        task["maxRetries"] = 0
        task["serviceAccountName"] = "unverified"
        with self.assertRaises(activation.Stop):
            activation.validate_job(job, s)

    def test_enrollment_import_and_retry_have_distinct_gates(self):
        s = fixture()
        with patch.object(activation, "approve") as approve, patch.object(activation, "baseline"), \
                patch.object(activation, "idle"), patch.object(activation, "scheduler", return_value=[]), \
                patch.object(activation, "run") as run, patch("sys.stdout", new_callable=io.StringIO):
            with self.assertRaises(activation.Stop):
                activation.pilot(s, "enroll", Mock())
            with self.assertRaises(activation.Stop):
                activation.pilot(s, "sync", Mock())
            for phase in ("verify", "enroll", "sync"):
                activation.pilot(s, phase, Mock())
        self.assertEqual([x.args[0] for x in approve.call_args_list], ["verify", "enroll", "sync"])
        self.assertNotIn("--apply", str(run.call_args_list[0]))
        self.assertIn(",--apply", str(run.call_args_list[1]))
        self.assertEqual(run.call_args_list[2].args, ("jobs", "execute", activation.JOB, "--wait"))

    def test_reconciliation_checks_root_lookalike_drafts_totals_and_coverage(self):
        s = fixture()
        run_key = "timeRuns/" + activation.key("quickbooks-time-customer", "30", "70")
        cp_key = "syncCheckpoints/" + activation.key("quickbooks-time", "30", "71")
        anchor = "time-" + activation.key("30", "71")
        month = "2026-10"
        name = "WO project fixture"
        mapping = {"account": "30", "jobcodeId": "71", "scopeProjectId": anchor,
                   "sourceJob": {"id": "71", "parentId": "70", "active": True, "missing": False, "name": name},
                   "sourceProject": {"id": "91", "state": "verified", "parentJobcodeId": "70"}}
        docs = {
            run_key: {"customerBound": True, "status": "complete", "failedCount": 0, "lastSuccess": s["cutoff"]},
            cp_key: {"through": s["cutoff"], "failed": False},
            "projects/" + anchor: {"published": False, "name": name},
            "projectViews/" + anchor: {"published": False},
            f"timeProjectTotals/{anchor}/periods/{month}": {"recorded": 3601, "allocated": 600},
            f"timeProjectTotals/{anchor}/periods/lifetime": {"recorded": 3601, "allocated": 600},
        }
        report = Mock()
        report.mappings.return_value = [mapping]
        report.doc.side_effect = lambda path, **_: docs[path]
        totals = {("71", month): 3601}
        self.assertEqual(activation.reconciliation(s, totals, report)["checkpoint_coverage"], "passed")
        with self.assertRaisesRegex(activation.Stop, "totals"):
            activation.reconciliation(s, {("71", month): 3600}, report)
        report.mappings.return_value = [mapping, {"jobcodeId": "70"}]
        with self.assertRaisesRegex(activation.Stop, "catalog"):
            activation.reconciliation(s, totals, report)
        report.mappings.return_value = [mapping]
        mapping["sourceJob"]["parentId"] = "108"
        with self.assertRaisesRegex(activation.Stop, "scope"):
            activation.reconciliation(s, totals, report)
        mapping["sourceJob"]["parentId"] = "70"
        docs["projectViews/" + anchor]["published"] = True
        with self.assertRaisesRegex(activation.Stop, "unpublished"):
            activation.reconciliation(s, totals, report)
        docs["projectViews/" + anchor]["published"] = False
        docs[cp_key]["failed"] = True
        with self.assertRaisesRegex(activation.Stop, "checkpoint"):
            activation.reconciliation(s, totals, report)

    def test_candidate_rejects_unreviewed_runtime_drift_and_normal_traffic(self):
        s = fixture()
        candidate = activation.SERVICE + "-00002-test"
        targets = [{"tag": activation.TAG, "revisionName": candidate,
                    "url": f"https://{activation.TAG}---test.run.app", "percent": 0}]
        old = {"SECURE_RUNTIME_SETTING": "keep"}
        profile = {"containerConcurrency": 80}
        with patch.object(activation, "baseline", return_value={"status": {"traffic": targets}}), \
                patch.object(activation, "revision") as revision:
            revision.side_effect = lambda name: (
                s["image"], {**old, **activation.time_env(s)} if name == candidate else old,
                210, profile,
            )
            self.assertEqual(activation.candidate(s)[0], candidate)
            targets[0]["percent"] = 1
            with self.assertRaisesRegex(activation.Stop, "zero normal traffic"):
                activation.candidate(s)
            targets[0]["percent"] = 0
            revision.side_effect = lambda name: (
                s["image"], {**old, **activation.time_env(s)} if name == candidate else old,
                210, {"containerConcurrency": 1} if name == candidate else profile,
            )
            with self.assertRaisesRegex(activation.Stop, "environment or timeout"):
                activation.candidate(s)

    def test_scheduler_rejects_other_endpoint_and_reviewed_oauth_shape(self):
        s = fixture()
        s["invoker"] = "example-invoker"
        config = {"schedule": "0 6 * * *", "timeZone": "America/Regina", "attemptDeadline": "30s",
                  "retryConfig": {"retryCount": 1}, "state": "PAUSED",
                  "httpTarget": {"uri": activation.JOB_URI, "httpMethod": "POST",
                                 "oauthToken": {"serviceAccountEmail": s["invoker"],
                                                "scope": "https://www.googleapis.com/auth/cloud-platform"}}}
        with patch.object(activation, "scheduler", return_value=config):
            self.assertEqual(activation.schedule(s), "PAUSED")
            config["httpTarget"]["uri"] += "wrong"
            with self.assertRaises(activation.Stop):
                activation.schedule(s)


if __name__ == "__main__":
    unittest.main()
