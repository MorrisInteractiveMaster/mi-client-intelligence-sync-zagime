import { once } from "node:events";
import { firebaseRuntime, FirebaseIdentityVerifier } from "../server/firebase";
import { FirestoreTenantStore, key } from "../server/firestore-store";
import { ReportingBackend } from "../server/backend";
import { apiServer, RequestLimit } from "../server/http";
import { demo, allocate, project } from "../src/reporting/model";
export const PASSWORD = "synthetic-emulator-only-password";
export async function m5Fixture(port = 0) {
  const runtime = firebaseRuntime(
    "emulator",
    "demo-mi-security",
    "mi-client-staging",
  );
  const tenant = "m5-lab",
    root = runtime.db.doc(`tenants/${tenant}`);
  for (const uid of [
    "m5-admin",
    "m5-editor",
    "m5-narrow",
    "m5-client",
    "m5-unknown",
    "m5-first",
  ]) {
    await runtime.auth.createUser({
      uid,
      email: `${uid}@example.com`,
      password: PASSWORD,
      emailVerified: true,
    });
  }
  await runtime.auth.updateUser("m5-first", {
    providerToLink: {
      providerId: "google.com",
      uid: "synthetic-provider-first",
    },
  });
  let s = demo();
  s.tenant = { id: tenant, name: "Morris synthetic staging lab" };
  s.agreements.forEach((a) => (a.tenantId = tenant));
  s.raw.forEach((r) => (r.tenantId = tenant));
  s = allocate(
    s,
    "raw-demo",
    [
      {
        projectId: "delivery-0",
        seconds: 18000,
        description: "Synthetic five-hour allocation",
      },
    ],
    "fixture",
  );
  s.raw.push({
    ...s.raw[0],
    id: "unallocated",
    seconds: 7200,
    description: "Synthetic unallocated time",
  });
  s.raw.push({
    ...s.raw[0],
    id: "september",
    date: "2026-09-12",
    seconds: 3600,
    description: "Synthetic previous month",
  });
  s = allocate(
    s,
    "september",
    [{ projectId: "delivery-0", seconds: 3600, description: "Previous month" }],
    "fixture",
  );
  const b = runtime.db.batch();
  b.set(root, { name: s.tenant.name, revision: 1 });
  for (const { caps, ...a } of s.agreements) {
    b.set(root.collection("agreements").doc(a.id), a);
    for (const c of caps)
      b.set(
        root
          .collection("agreementCapRevisions")
          .doc(key(a.id, c.month, String(c.revision))),
        { ...c, agreementId: a.id },
      );
  }
  for (const d of s.departments)
    b.set(root.collection("departments").doc(d.id), d);
  for (const d of s.budgets)
    b.set(
      root
        .collection("departmentBudgets")
        .doc(key(d.agreementId, d.departmentId, d.month)),
      d,
    );
  const lifetime = project(s);
  for (const p of s.projects) {
    b.set(root.collection("projects").doc(p.id), p);
    b.set(root.collection("projectViews").doc(p.id), {
      ...p,
      lifetimeSeconds: lifetime.projects.find((x) => x.id === p.id)!
        .lifetimeSeconds,
    });
    for (const month of ["2026-09", "2026-10"])
      b.set(root.collection("projectPeriods").doc(key(month, p.id)), {
        projectId: p.id,
        month,
        seconds: project(s, { month }).projects.find((x) => x.id === p.id)!
          .seconds,
      });
  }
  for (const r of s.raw)
    b.set(root.collection("rawTime").doc(r.id), {
      source: "synthetic",
      record: r,
    });
  for (const a of s.allocations) {
    b.set(
      root
        .collection("allocationRevisions")
        .doc(key(a.sourceId, String(a.revision))),
      a,
    );
    b.set(root.collection("allocationHeads").doc(a.sourceId), {
      revision: a.revision,
      portions: a.portions,
      appliedPortions: a.portions,
      sourceRevision: s.raw.find((r) => r.id === a.sourceId)!.revision,
    });
  }
  for (const [subject, role] of [
    ["m5-admin", "administrator"],
    ["m5-editor", "editor"],
    ["m5-narrow", "editor"],
    ["m5-client", "client"],
  ])
    b.set(root.collection("memberships").doc(key(subject)), {
      tenantId: tenant,
      subject,
      role,
      approved: true,
      enabled: true,
      agreementIds: ["agreement-demo"],
      projectIds:
        subject === "m5-narrow" ? ["delivery-0"] : "all-authorized-agreements",
    });
  await b.commit();
  const backend = new ReportingBackend(
    new FirestoreTenantStore(runtime.db),
    new FirebaseIdentityVerifier(runtime.auth),
    {
      issuer: "https://securetoken.google.com/demo-mi-security",
      audience: "demo-mi-security",
      now: Date.now,
    },
  );
  const server = apiServer(backend, {
    allowedOrigin: "http://127.0.0.1:5173",
    limit: new RequestLimit(10000),
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  async function token(uid: string) {
    const r = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${uid}@example.com`,
          password: PASSWORD,
          returnSecureToken: true,
        }),
      },
    );
    if (!r.ok) throw Error("Synthetic login failed");
    return ((await r.json()) as any).idToken as string;
  }
  return {
    runtime,
    root,
    base,
    token,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await runtime.close();
    },
  };
}
