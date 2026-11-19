import { writeFileSync } from "node:fs";

const {
  VITE_DASHBOARD_DEPLOYMENT: mode,
  VITE_SECURE_TENANT_ID: tenant,
  VITE_MORRIS_ENTRA_TENANT_ID: entraTenant,
  VITE_FIREBASE_API_KEY: apiKey,
  VITE_FIREBASE_APP_ID: appId,
  VITE_FIREBASE_AUTH_DOMAIN: authDomain,
  VITE_AUTH_EMULATOR: emulator,
} = process.env;
if (!["staging", "production"].includes(mode))
  throw Error("Invalid dashboard image deployment profile");
if (mode === "production" && (
  !/^[a-z][a-z0-9-]{1,100}$/.test(tenant ?? "") || tenant.startsWith("synthetic-") ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entraTenant ?? "") ||
  !/^[a-zA-Z0-9_-]{20,}$/.test(apiKey ?? "") || !/^1:\d+:web:[a-f0-9]+$/.test(appId ?? "") ||
  !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(authDomain ?? "") || emulator === "true"
))
  throw Error("Missing approved production frontend build configuration");
writeFileSync("dist-server/dashboard-profile.json", JSON.stringify({ mode, tenant, entraTenant }));
