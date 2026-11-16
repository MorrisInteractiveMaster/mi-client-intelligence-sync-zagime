import {
  STAGING_SERVICE_ACCOUNT,
  verifyAttachedIdentity,
} from "./attached-identity";
// Explicit read-only existing-runner check; live Firebase/API flags need not be enabled.
if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--approved-read-only-identity-check" ||
  process.env.BACKEND_MODE !== "staging" ||
  process.env.STAGING_FIREBASE_PROJECT_ID !== "morris-client-dash-zagime" ||
  process.env.FIRESTORE_DATABASE_ID !== "mi-client-staging" ||
  process.env.STAGING_DATABASE_UID !== "6d09ea71-f495-44a5-94a6-732ed1c47d88" ||
  process.env.STAGING_SERVICE_ACCOUNT_EMAIL !== STAGING_SERVICE_ACCOUNT ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw Error("Explicit approved read-only staging identity check required");
await verifyAttachedIdentity(STAGING_SERVICE_ACCOUNT);
console.log(
  JSON.stringify({
    attachedIdentityMatched: true,
    firestoreOperations: 0,
    apiActivated: false,
  }),
);
