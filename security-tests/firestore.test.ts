import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
} from "firebase/firestore";
let env: RulesTestEnvironment;
before(async () => {
  if (
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.GCLOUD_PROJECT !== "demo-mi-security"
  )
    throw Error("Refusing non-local/non-demo security test");
  env = await initializeTestEnvironment({
    projectId: "demo-mi-security",
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "tenants/tenant-a/projects/private"), {
      tenantId: "tenant-a",
      published: false,
      internalNotes: "synthetic",
    });
    await setDoc(doc(c.firestore(), "tenants/tenant-a/publications/current"), {
      published: true,
    });
  });
});
after(async () => {
  await env?.cleanup();
});
for (const role of ["unauthenticated", "client", "editor", "administrator"])
  test("deny-all browser policy: " + role, async () => {
    const db =
      role === "unauthenticated"
        ? env.unauthenticatedContext().firestore()
        : env
            .authenticatedContext("test-" + role, {
              role,
              tenantId: "tenant-a",
              approved: true,
            })
            .firestore();
    for (const path of [
      "tenants/tenant-a/projects/private",
      "tenants/tenant-b/projects/private",
      "tenants/tenant-a/publications/current",
      "tenants/tenant-a/rawTime/raw",
      "tenants/tenant-a/checkpoints/time",
      "tenants/tenant-a/audits/a",
    ]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(
        setDoc(doc(db, path), { tenantId: "tenant-a", published: true }),
      );
    }
    await assertFails(getDocs(collection(db, "tenants/tenant-a/projects")));
    await assertFails(
      updateDoc(doc(db, "tenants/tenant-a/projects/private"), {
        published: true,
      }),
    );
    await assertFails(deleteDoc(doc(db, "tenants/tenant-a/projects/private")));
  });
test("role escalation, forged owner and nested/orphan collection bypasses deny", async () => {
  const db = env
    .authenticatedContext("client", {
      role: "administrator",
      tenantId: "tenant-b",
    })
    .firestore();
  for (const path of [
    "tenants/tenant-a/memberships/client",
    "users/client",
    "tenants/absent/projects/p/secret/x",
  ])
    await assertFails(
      setDoc(doc(db, path), {
        role: "administrator",
        uid: "other",
        approved: true,
      }),
    );
});
