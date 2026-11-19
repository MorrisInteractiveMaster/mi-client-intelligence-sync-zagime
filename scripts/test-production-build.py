"""Offline tests for the owner-operated production image build."""
import copy
import importlib.util
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("production_build", Path(__file__).with_name("production-build.py"))
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)
REVISION = "a" * 40
TAG = f"{build.IMAGE}:{REVISION}-123456789abc"
DIGEST = "sha256:" + "b" * 64
BUCKET = "gs://approved-montreal-source"
ID = "12345678-1234-1234-1234-123456789abc"
VALUES = {
    "VITE_FIREBASE_API_KEY": "A" * 39,
    "VITE_FIREBASE_APP_ID": "1:892989290947:web:aaaaaaa",
    "VITE_FIREBASE_AUTH_DOMAIN": f"{build.PROJECT}.firebaseapp.com",
    "MORRIS_ENTRA_TENANT_ID": ID,
}


class ProductionBuildTest(unittest.TestCase):
    def test_approval_and_public_settings_fail_before_cloud_calls(self):
        with patch.object(build, "gcloud") as cloud, patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(build.Stop, "approval"):
                build.submit(REVISION, BUCKET, Path("."), False)
            with self.assertRaisesRegex(build.Stop, "public"):
                build.submit(REVISION, BUCKET, Path("."), True)
            cloud.assert_not_called()

    def test_subset_of_cloud_scope_for_submission(self):
        replies = [
            [{"name": BUCKET.removeprefix("gs://")}],
            {"location": build.REGION.upper()},
            {"format": "DOCKER"},
            {"id": ID},
        ]
        with patch.dict(os.environ, VALUES, clear=True), patch.object(build, "gcloud", side_effect=replies) as cloud:
            with patch.object(subprocess, "run") as archive, patch("builtins.print"):
                build.submit(REVISION, BUCKET, Path("reviewed"), True)
        args = cloud.call_args.args
        self.assertEqual(args[:2], ("builds", "submit"))
        self.assertTrue(cloud.call_args.kwargs["regional"])
        self.assertIn(f"--service-account={build.ACCOUNT_RESOURCE}", args)
        self.assertIn(f"--gcs-source-staging-dir={BUCKET}/{build.SOURCE_PREFIX.rstrip('/')}", args)
        self.assertNotIn("--gcs-log-dir", " ".join(args))
        self.assertTrue(str(args[2]).endswith("source.tar.gz"))
        self.assertEqual(archive.call_args.args[0][-1], REVISION)
        self.assertEqual(build.CONFIG.name, "cloudbuild-production.yaml")

    def test_cross_project_and_wrong_region_fail_before_archive(self):
        for replies in ([[]], [[{"name": BUCKET.removeprefix("gs://")}], {"location": "US"}]):
            with self.subTest(replies=replies), patch.dict(os.environ, VALUES, clear=True):
                with patch.object(build, "gcloud", side_effect=replies), patch.object(subprocess, "run") as archive:
                    with self.assertRaises(build.Stop):
                        build.submit(REVISION, BUCKET, Path("."), True)
                    archive.assert_not_called()

    def test_verify_requires_production_scope_and_successful_digest(self):
        record = {
            "status": "SUCCESS",
            "serviceAccount": build.ACCOUNT_RESOURCE,
            "options": {"logging": "CLOUD_LOGGING_ONLY"},
            "source": {"storageSource": {"bucket": BUCKET.removeprefix("gs://"), "object": build.SOURCE_PREFIX + "source.tgz"}},
            "substitutions": {"_IMAGE": TAG, "_REVISION": REVISION},
            "steps": [{
                "name": "gcr.io/cloud-builders/docker", "status": "SUCCESS",
                "args": ["--platform=linux/amd64", "VITE_DASHBOARD_DEPLOYMENT=production",
                         "VITE_SECURE_TENANT_ID=zagime-production", "org.opencontainers.image.revision=${_REVISION}"],
            }],
            "results": {"images": [{"name": TAG, "digest": DIGEST}]},
        }
        self.assertEqual(build.verified_image(record, REVISION, BUCKET), f"{build.IMAGE}@{DIGEST}")
        changes = [
            ("status", "FAILURE"),
            ("serviceAccount", "projects/test/serviceAccounts/compute@example.com"),
            ("options", {"logging": "LEGACY"}),
            ("source", {"storageSource": {"bucket": BUCKET.removeprefix("gs://"), "object": "other/source.tgz"}}),
            ("substitutions", {"_IMAGE": TAG, "_REVISION": "c" * 40}),
            ("steps", [{**record["steps"][0], "args": ["VITE_DASHBOARD_DEPLOYMENT=staging"]}]),
            ("results", {"images": [{"name": TAG, "digest": "bad"}]}),
        ]
        for key, value in changes:
            with self.subTest(key=key):
                invalid = copy.deepcopy(record)
                invalid[key] = value
                with self.assertRaises(build.Stop):
                    build.verified_image(invalid, REVISION, BUCKET)


if __name__ == "__main__":
    unittest.main()
