#!/usr/bin/env python3
"""Submit or verify one approved production-profile image build in Cloud Shell."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from uuid import uuid4

PROJECT = "morris-client-dash-zagime"
REGION = "northamerica-northeast1"
ACCOUNT = f"mi-client-build@{PROJECT}.iam.gserviceaccount.com"
ACCOUNT_RESOURCE = f"projects/{PROJECT}/serviceAccounts/{ACCOUNT}"
IMAGE = f"{REGION}-docker.pkg.dev/{PROJECT}/mi-client-build/mi-client-production"
SOURCE_PREFIX = "production-build-source/"
CONFIG = Path(__file__).resolve().parents[1] / "deployment/cloudbuild-production.yaml"
REVISION = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
BUILD_ID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")


class Stop(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Stop(message)


def gcloud(*args, regional=False):
    location = [f"--region={REGION}"] if regional else []
    result = subprocess.run(
        ["gcloud", *args, f"--project={PROJECT}", "--quiet", *location, "--format=json"],
        check=True, text=True, stdout=subprocess.PIPE,
    )
    return json.loads(result.stdout)


def source_name(bucket):
    require(re.fullmatch(r"gs://[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]", bucket),
            "Provide the exact existing gs:// source bucket without a path.")
    return bucket.removeprefix("gs://")


def public_values(environ):
    settings = {
        "_API_KEY": ("VITE_FIREBASE_API_KEY", r"[A-Za-z0-9_-]{20,128}"),
        "_APP_ID": ("VITE_FIREBASE_APP_ID", r"1:892989290947:web:[a-f0-9]+"),
        "_AUTH_DOMAIN": ("VITE_FIREBASE_AUTH_DOMAIN", r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}"),
        "_ENTRA_TENANT": ("MORRIS_ENTRA_TENANT_ID", r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}"),
    }
    result = {}
    for key, (name, pattern) in settings.items():
        value = environ.get(name, "")
        require(re.fullmatch(pattern, value), f"Set the approved public {name}.")
        result[key] = value
    return result


def submit(revision, bucket, repository, approved):
    require(approved, "Obtain owner build approval and pass --approved-build.")
    settings = public_values(os.environ)
    owned = gcloud("storage", "buckets", "list")
    require(any(row.get("name") == source_name(bucket) for row in owned),
            "The source bucket must exist in the target project.")
    metadata = gcloud("storage", "buckets", "describe", bucket)
    require(str(metadata.get("location", "")).lower() == REGION,
            "The source bucket must be in Montréal.")
    registry = gcloud("artifacts", "repositories", "describe", "mi-client-build", f"--location={REGION}")
    require(registry.get("format") == "DOCKER", "The regional Docker repository must already exist.")
    settings.update(_IMAGE=f"{IMAGE}:{revision}-{uuid4().hex[:12]}", _REVISION=revision)
    with tempfile.TemporaryDirectory(prefix="mi-prod-build-") as work:
        archive = Path(work) / "source.tar.gz"
        subprocess.run(
            ["git", "-C", str(repository), "archive", "--format=tar.gz", "-o", str(archive), revision],
            check=True,
        )
        result = gcloud(
            "builds", "submit", str(archive), "--async", f"--config={CONFIG}",
            f"--service-account={ACCOUNT_RESOURCE}",
            f"--gcs-source-staging-dir={bucket}/{SOURCE_PREFIX.rstrip('/')}",
            "--substitutions=" + ",".join(f"{key}={value}" for key, value in settings.items()),
            regional=True,
        )
    build_id = result.get("id") or result.get("metadata", {}).get("build", {}).get("id", "")
    require(BUILD_ID.fullmatch(build_id), "Build ID unavailable. Check build history before retrying.")
    print(f"Submitted build {build_id} in {REGION}. Keep the build ID and run verify after completion.")


def verified_image(build, revision, bucket):
    require(build.get("status") == "SUCCESS", f"Build status is {build.get('status', 'unknown')}.")
    require(build.get("serviceAccount") in {ACCOUNT_RESOURCE, f"projects/892989290947/serviceAccounts/{ACCOUNT}"},
            "Cloud Build did not report the dedicated build identity.")
    require(build.get("options", {}).get("logging") == "CLOUD_LOGGING_ONLY" and not build.get("logsBucket"),
            "Unexpected build log destination.")
    source = build.get("source", {}).get("storageSource", {})
    require(source.get("bucket") == source_name(bucket) and source.get("object", "").startswith(SOURCE_PREFIX),
            "The build did not use the approved source bucket and prefix.")
    substitutions = build.get("substitutions", {})
    tag = substitutions.get("_IMAGE", "")
    require(substitutions.get("_REVISION") == revision and
            re.fullmatch(re.escape(f"{IMAGE}:{revision}-") + r"[a-f0-9]{12}", tag),
            "Build revision or destination differs from the approved source.")
    steps = build.get("steps", [])
    require(len(steps) == 1 and steps[0].get("name") == "gcr.io/cloud-builders/docker" and
            steps[0].get("status") == "SUCCESS", "Successful Docker execution was not verified.")
    args = steps[0].get("args", [])
    revision_labels = {f"org.opencontainers.image.revision={revision}", "org.opencontainers.image.revision=${_REVISION}"}
    require("VITE_DASHBOARD_DEPLOYMENT=production" in args and "VITE_SECURE_TENANT_ID=zagime-production" in args
            and "--platform=linux/amd64" in args and revision_labels.intersection(args),
            "Production Docker arguments were not verified.")
    images = build.get("results", {}).get("images", [])
    require(len(images) == 1 and images[0].get("name") == tag and DIGEST.fullmatch(images[0].get("digest", "")),
            "Cloud Build did not publish the expected image and digest.")
    return f"{IMAGE}@{images[0]['digest']}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    phases = parser.add_subparsers(dest="phase", required=True)
    for phase in ("submit", "verify"):
        sub = phases.add_parser(phase)
        sub.add_argument("--revision", required=True)
        sub.add_argument("--source-bucket", required=True)
        if phase == "submit":
            sub.add_argument("--repository", type=Path, required=True, help="Local checkout containing the reviewed SHA")
            sub.add_argument("--approved-build", action="store_true")
        else:
            sub.add_argument("--build-id", required=True)
    args = parser.parse_args()
    try:
        require(REVISION.fullmatch(args.revision), "Provide the full reviewed Git commit SHA.")
        source_name(args.source_bucket)
        if args.phase == "submit":
            submit(args.revision, args.source_bucket, args.repository, args.approved_build)
        else:
            require(BUILD_ID.fullmatch(args.build_id), "Provide the exact Cloud Build ID.")
            build = gcloud("builds", "describe", args.build_id, regional=True)
            image = verified_image(build, args.revision, args.source_bucket)
            registry = gcloud("artifacts", "docker", "images", "describe", image)
            require(registry.get("image_summary", {}).get("digest") == image.rsplit("@", 1)[1],
                    "Artifact Registry did not confirm the immutable digest.")
            print(image)
    except (OSError, Stop, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        # Avoid echoing failed subprocess arguments, which can include public app configuration.
        parser.exit(2, f"STOP: {error if isinstance(error, Stop) else 'A required command failed. Review its sanitized error and build history.'}\n")


if __name__ == "__main__":
    main()
