export const STAGING_SERVICE_ACCOUNT =
  "mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com";
/** Runtime metadata only. No credentials, IAM changes, Auth operations or Firestore reads/writes. */
export async function verifyAttachedIdentity(
  expected: string,
  request: typeof fetch = (input, init) => fetch(input, init),
) {
  if (
    !/^[a-z][a-z0-9-]{5,29}@[a-z][a-z0-9-]{5,29}\.iam\.gserviceaccount\.com$/.test(
      expected,
    )
  )
    throw Error("Approved staging identity required");
  try {
    const r = await request(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
      {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      },
    );
    if (
      !r.ok ||
      r.headers.get("Metadata-Flavor") !== "Google" ||
      (await r.text()).trim() !== expected
    )
      throw Error();
  } catch {
    throw Error("Attached staging identity verification failed");
  }
}
