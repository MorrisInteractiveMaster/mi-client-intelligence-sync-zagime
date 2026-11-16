import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Auth } from "firebase/auth";
import { SecuredApiClient, type Report } from "./client";
import { hours } from "../reporting/model";
import "../reporting/nordic.css";
const enabled = import.meta.env.VITE_ENABLE_SECURE_API === "true";
export function SecureDashboard() {
  const [auth, setAuth] = useState<Auth>();
  const [subject, setSubject] = useState<string | null>(null);
  const signedIn = subject !== null;
  const [view, setView] = useState<Report>();
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
      if (!apiKey) throw Error("Protected sign-in is not configured.");
      const app = initializeApp(
        {
          apiKey,
          projectId: "morris-client-dash-zagime",
          appId: "1:892989290947:web:d5189c017d20b65cc0a576",
          authDomain: "morris-client-dash-zagime.firebaseapp.com",
        },
        "protected-browser",
      );
      const a = sdk.getAuth(app);
      await sdk.setPersistence(a, sdk.inMemoryPersistence);
      if (active) {
        setAuth(a);
        unsubscribe = sdk.onAuthStateChanged(a, (u) => {
          setView(undefined);
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
  useEffect(() => {
    if (!signedIn || !auth) return;
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    setView(undefined);
    let client: SecuredApiClient;
    try {
      client = new SecuredApiClient(
        enabled,
        import.meta.env.VITE_SECURE_API_ORIGIN ?? "",
        async () => {
          if (!auth.currentUser || auth.currentUser.uid !== subject)
            throw Error("Please sign in again.");
          return auth.currentUser.getIdToken();
        },
      );
    } catch {
      setLoading(false);
      setError("Protected workspace is not configured.");
      return () => abort.abort();
    }
    client
      .report(import.meta.env.VITE_SECURE_TENANT_ID ?? "", month, abort.signal)
      .then((v) => {
        if (active && auth.currentUser?.uid === subject) {
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
  }, [auth, signedIn, subject, month]);
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
      await sdk.signInWithPopup(
        auth,
        provider === "google"
          ? new sdk.GoogleAuthProvider()
          : new sdk.OAuthProvider("microsoft.com"),
      );
    } catch {
      setError("Sign-in was not completed.");
    }
  }
  return (
    <section className="nordic">
      <h1>Protected client workspace</h1>
      <Link to="/">Synthetic demonstration</Link>
      {!signedIn ? (
        <>
          <button disabled={!auth} onClick={() => void signIn("google")}>
            Sign in with Google
          </button>
          <button disabled={!auth} onClick={() => void signIn("microsoft")}>
            Sign in with Microsoft
          </button>
          <p>An account must be separately approved for this workspace.</p>
        </>
      ) : (
        <>
          <button
            onClick={async () => {
              if (auth) {
                const sdk = await import("firebase/auth");
                await sdk.signOut(auth);
                setView(undefined);
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
      {view && (
        <>
          <h2>{view.tenant.name}</h2>
          <p>
            {hours(view.totalSeconds)} h delivered in {view.month}
          </p>
          {view.agreements.map((a) => (
            <article key={a.id}>
              <h3>{a.name}</h3>
              <p>
                {hours(a.seconds)} h delivered · {a.capMinutes / 60} h monthly
                cap
              </p>
              {a.departments.map((d) => (
                <details key={d.id} open>
                  <summary>
                    {d.name} · {hours(d.seconds)} h delivered
                  </summary>
                  {view.projects
                    .filter(
                      (p) => p.agreementId === a.id && p.departmentId === d.id,
                    )
                    .map((p) => (
                      <p key={p.id}>
                        {p.name}: {hours(p.seconds)} h this month ·{" "}
                        {hours(p.lifetimeSeconds)} h lifetime · {p.progress}%
                        manager progress
                      </p>
                    ))}
                </details>
              ))}
            </article>
          ))}
          {!view.projects.length && (
            <p>No approved projects are available for this period.</p>
          )}
        </>
      )}
    </section>
  );
}
