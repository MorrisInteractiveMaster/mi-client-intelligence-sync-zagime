import { ProjectStaffWorkspace } from "./ProjectWorkspace";
import type { ProjectWorkspace, ProjectReport } from "../projects/model";
import "./secure.css";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Auth } from "firebase/auth";
import { SecuredApiClient } from "./client";
import { hours } from "../reporting/model";
import "../reporting/nordic.css";
const enabled = import.meta.env.VITE_ENABLE_SECURE_API === "true";
export function SecureDashboard() {
  const [auth, setAuth] = useState<Auth>();
  const [microsoftProof, setMicrosoftProof] = useState<{ idToken: string; accessToken: string }>();
  const [subject, setSubject] = useState<string | null>(null);
  const signedIn = subject !== null;
  const [workspace, setWorkspace] = useState<ProjectWorkspace>();
  const [view, setView] = useState<ProjectReport>();
  const [error, setError] = useState("");
  const [month, setMonth] = useState("2026-10");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let unsubscribe: (() => void) | undefined;
    let active = true;
    (async () => {
      const { initializeApp } = await import("firebase/app");
      const sdk = await import("firebase/auth");
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      if (
        !apiKey ||
        !import.meta.env.VITE_FIREBASE_PROJECT_ID ||
        !import.meta.env.VITE_FIREBASE_APP_ID ||
        !import.meta.env.VITE_FIREBASE_AUTH_DOMAIN
      )
        throw Error("Protected sign-in is not configured.");
      if (import.meta.env.VITE_AUTH_EMULATOR === "true") {
        if (
          location.hostname !== "127.0.0.1" ||
          import.meta.env.VITE_FIREBASE_PROJECT_ID !== "demo-mi-security" ||
          import.meta.env.VITE_SECURE_API_ORIGIN !== "http://127.0.0.1:8081"
        )
          throw Error("Unsafe emulator configuration");
      }
      const app = initializeApp(
        {
          apiKey,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          appId: import.meta.env.VITE_FIREBASE_APP_ID,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        },
        "protected-browser",
      );
      const a = sdk.getAuth(app);
      if (import.meta.env.VITE_AUTH_EMULATOR === "true") {
        sdk.connectAuthEmulator(a, "http://127.0.0.1:9099", {
          disableWarnings: true,
        });
      }
      await sdk.setPersistence(a, sdk.inMemoryPersistence);
      if (active) {
        setAuth(a);
        unsubscribe = sdk.onAuthStateChanged(a, (u) => {
          setView(undefined);
          setWorkspace(undefined);
          setSubject(u?.uid ?? null);
        });
      }
    })().catch(() => {
      if (active) setError("Protected sign-in is not configured.");
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  const client = useMemo(() => {
    if (!signedIn || !auth) return undefined;
    try {
      return new SecuredApiClient(
        enabled,
        import.meta.env.VITE_SECURE_API_ORIGIN ?? "",
        async () => {
          if (!auth.currentUser || auth.currentUser.uid !== subject)
            throw Error("Please sign in again.");
          return auth.currentUser.getIdToken();
        },
        undefined,
        () => microsoftProof,
        "projects",
      );
    } catch {
      return undefined;
    }
  }, [auth, signedIn, subject, microsoftProof]);
  useEffect(() => {
    if (!client) return;
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    client
      .call<ProjectWorkspace>(
        import.meta.env.VITE_SECURE_TENANT_ID ?? "",
        "workspace",
        { signal: abort.signal },
      )
      .then((w) => {
        if (active) {
          setWorkspace(w);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [client]);
  useEffect(() => {
    if (!client || workspace?.role !== "client") return;
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    setView(undefined);
    client
      .call<ProjectReport>(import.meta.env.VITE_SECURE_TENANT_ID ?? "", "report?month=" + month, { signal: abort.signal })
      .then((v) => {
        if (active) {
          setView(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [client, workspace, month]);
  if (!enabled)
    return (
      <section>
        <h1>Protected workspace unavailable</h1>
        <Link to="/">Return to demonstration</Link>
      </section>
    );
  async function signIn(provider: "google" | "microsoft") {
    if (!auth) return;
    try {
      const sdk = await import("firebase/auth");
      setMicrosoftProof(undefined);
      const p = provider === "google" ? new sdk.GoogleAuthProvider() : new sdk.OAuthProvider("microsoft.com");
      if (provider === "microsoft") {
        const tenant = import.meta.env.VITE_MORRIS_ENTRA_TENANT_ID;
        if (!/^[0-9a-f-]{36}$/i.test(tenant ?? "")) throw Error("Microsoft sign-in is not configured");
        p.setCustomParameters({ tenant, prompt: "select_account" });
        p.addScope("User.Read.All");
      }
      const result = await sdk.signInWithPopup(auth, p);
      if (provider === "microsoft") {
        const credential = sdk.OAuthProvider.credentialFromResult(result);
        if (!credential?.idToken || !credential.accessToken) { await sdk.signOut(auth); throw Error(); }
        setMicrosoftProof({ idToken: credential.idToken, accessToken: credential.accessToken });
      }
    } catch {
      setError("Sign-in was not completed.");
    }
  }
  return (
    <section className="nordic secure-shell">
      <h1>Morris protected workspace</h1>
      <Link to="/">Synthetic demonstration</Link>
      {!signedIn ? (
        <>
          <button disabled={!auth} onClick={() => void signIn("google")}>
            Sign in with Google
          </button>
          <button disabled={!auth} onClick={() => void signIn("microsoft")}>
            Sign in with Microsoft
          </button>
          {import.meta.env.VITE_AUTH_EMULATOR === "true" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  const sdk = await import("firebase/auth");
                  await sdk.signInWithEmailAndPassword(
                    auth!,
                    String(f.get("email")),
                    String(f.get("password")),
                  );
                } catch {
                  setError("Synthetic emulator sign-in failed.");
                }
              }}
            >
              <label>
                Synthetic email
                <input name="email" type="email" required />
              </label>
              <label>
                Synthetic password
                <input name="password" type="password" required />
              </label>
              <button disabled={!auth}>Sign in to local emulator</button>
            </form>
          )}
          <p>Morris staff use their Microsoft work account. Client accounts have read-only access to approved publications.</p>
        </>
      ) : (
        <>
          <button
            onClick={async () => {
              if (auth) {
                const sdk = await import("firebase/auth");
                await sdk.signOut(auth);
                setMicrosoftProof(undefined);
                setView(undefined);
                setWorkspace(undefined);
              }
            }}
          >
            Sign out
          </button>
          <label>
            Reporting month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
        </>
      )}
      {loading && <p role="status">Loading approved reporting…</p>}
      {error && <p role="alert">{error}</p>}
      {workspace && workspace.role !== "client" && client && (
        <ProjectStaffWorkspace
          key={subject}
          client={client}
          tenant={import.meta.env.VITE_SECURE_TENANT_ID ?? ""}
          workspace={workspace}
          month={month}
          onDenied={() => {
            setWorkspace(undefined);
            setView(undefined);
            setError("Access changed. Sign out and sign in again.");
          }}
        />
      )}
      {view && (
        <>
          <h2>{view.tenant.name}</h2>
          <p>
            {hours(view.totalSeconds)} h delivered in {view.month}
          </p>
          {view.projects.map(p => <article key={p.id}><h3>{p.name}</h3><p>{p.description}</p><p>{p.status} · {p.progress}% progress</p><p>{hours(p.seconds)} h this month · {hours(p.lifetimeSeconds)} h lifetime</p></article>)}
          {!view.projects.length && (
            <p>No approved projects are available for this period.</p>
          )}
        </>
      )}
    </section>
  );
}
