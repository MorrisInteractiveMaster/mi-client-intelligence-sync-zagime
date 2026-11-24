import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { ProjectStaffWorkspace } from "./ProjectWorkspace";
import type { ProjectWorkspace } from "../projects/model";
import "./secure.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Auth } from "firebase/auth";
import { SecuredApiClient } from "./client";
import { branding, brandAsset } from "../config/branding";
import { ProjectClientReport } from "./ProjectClientReport";
import { today } from "./dashboard-format";
import { usePlatformRoute, useReportingMonth } from "./portal-location";
import { PlatformApplication } from "./PlatformApplication";
import "./platform.css";
import "./platform-theme.css";
import { ThemeSelector, usePlatformTheme } from "./PlatformTheme";
import "../reporting/nordic.css";
import "./workspace-sign-in.css";
const enabled = import.meta.env.VITE_ENABLE_SECURE_API === "true";
const production = import.meta.env.VITE_DASHBOARD_DEPLOYMENT === "production";
export function SecureDashboard() {
  const { theme, change, appearance } = usePlatformTheme();
  const [auth, setAuth] = useState<Auth>();
  const [microsoftProof, setMicrosoftProof] = useState<{
    idToken: string;
    accessToken: string;
  }>();
  const [subject, setSubject] = useState<string | null>(null);
  const signedIn = subject !== null;
  const [workspace, setWorkspace] = useState<ProjectWorkspace>();
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const route = usePlatformRoute();
  const modernShell = Boolean(route || workspace);
  const month = useReportingMonth(today().slice(0, 7));
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!unsaved || !route) return;
    const previous = window.location.href;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const pop = () => {
      if (window.location.href !== previous && !window.confirm("Leave without saving your changes?"))
        window.history.replaceState(window.history.state, "", previous);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", pop, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", pop, true);
    };
  }, [unsaved, route?.kind, location.pathname, location.search]);
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
  }, [client, retry]);
  const onDenied = useCallback(() => {
    setWorkspace(undefined);
    setError("Access changed. Sign out and sign in again.");
  }, []);
  if (!enabled)
    return (
      <section>
        <h1>Protected workspace unavailable</h1>
        {!production && <Link to="/">Return to demonstration</Link>}
      </section>
    );
  async function signIn(provider: "google" | "microsoft") {
    if (!auth) return;
    try {
      const sdk = await import("firebase/auth");
      setMicrosoftProof(undefined);
      const p =
        provider === "google"
          ? new sdk.GoogleAuthProvider()
          : new sdk.OAuthProvider("microsoft.com");
      if (provider === "microsoft") {
        const tenant = import.meta.env.VITE_MORRIS_ENTRA_TENANT_ID;
        if (!/^[0-9a-f-]{36}$/i.test(tenant ?? ""))
          throw Error("Microsoft sign-in is not configured");
        p.setCustomParameters({ tenant, prompt: "select_account" });
        p.addScope("User.Read.All");
      }
      const result = await sdk.signInWithPopup(auth, p);
      if (provider === "microsoft") {
        const credential = sdk.OAuthProvider.credentialFromResult(result);
        if (!credential?.idToken || !credential.accessToken) {
          await sdk.signOut(auth);
          throw Error();
        }
        setMicrosoftProof({
          idToken: credential.idToken,
          accessToken: credential.accessToken,
        });
      }
    } catch {
      setError("Sign-in was not completed.");
    }
  }
  return (
    <section className={"nordic secure-shell" + (modernShell ? " platform-shell" : "")} data-theme={appearance}>
      {signedIn && workspace && <a className="mi-skip-link" href="#platform-content" onClick={event => {
        const content = document.getElementById("platform-content");
        if (!content) return;
        event.preventDefault();
        content.tabIndex = -1;
        content.focus();
      }}>Skip to content</a>}
      <header className="secure-masthead">
        <div className="secure-brandmarks">
          {branding.clientLogo && (
            <img
              src={brandAsset(branding.clientLogo)}
              alt={branding.clientName}
            />
          )}
          {branding.partnerLogo && (
            <img
              src={brandAsset(branding.partnerLogo)}
              alt={branding.partnerName}
            />
          )}
        </div>
        <div className="secure-identity">
          <h1>
            {route ? (route.kind === "client" ? branding.clientName : "Morris Interactive") : workspace?.role === "client"
              ? "Client intelligence dashboard"
              : "Morris protected workspace"}
          </h1>
          {!signedIn && !production && <Link to="/">Synthetic demonstration</Link>}
        </div>
        <div className="mi-masthead-actions">
          {modernShell && signedIn && <div id="mi-workspace-commands" />}
          <ThemeSelector theme={theme} onChange={change} />
          {signedIn && (
          <details className="mi-account">
            <summary><UserRound size={17} aria-hidden="true" /> Account</summary>
            <div className="mi-account-menu"><p>{workspace?.role === "staff" ? "Morris workspace" : "Protected session"}</p><button
            className="secure-secondary"
            onClick={async () => {
              if (unsaved && !window.confirm("Sign out without saving your changes?")) return;
              if (auth) {
                const sdk = await import("firebase/auth");
                await sdk.signOut(auth);
                setMicrosoftProof(undefined);
                setWorkspace(undefined);
                setError("");
              }
            }}
          >
            Sign out
          </button></div></details>
          )}
        </div>
      </header>
      {!signedIn ? (
        <main className="mi-access" aria-labelledby="workspace-sign-in">
          <div className="mi-access-story">
            <p>{branding.partnerName} <span aria-hidden="true">/</span> {branding.clientName}</p>
            <strong>Client Intelligence</strong>
            <p>A shared view of project delivery, milestones and approved reporting.</p>
          </div>
          <div className="mi-access-card">
            <span className="mi-access-mark"><LockKeyhole size={23} aria-hidden="true" /></span>
            <p className="mi-access-product">Client Intelligence Platform</p>
            <h2 id="workspace-sign-in">Sign in to your workspace</h2>
            <p id="workspace-provider-help">Use the account that has access to your workspace.</p>
            <div className="mi-access-providers" aria-describedby="workspace-provider-help">
              <button type="button" disabled={!auth} aria-label="Sign in with Google" onClick={() => void signIn("google")}>
                <span><strong>Sign in with Google</strong><small>For approved client accounts</small></span>
                <ArrowRight size={19} aria-hidden="true" />
              </button>
              <button type="button" disabled={!auth} aria-label="Sign in with Microsoft" onClick={() => void signIn("microsoft")}>
                <span><strong>Sign in with Microsoft</strong><small>For Morris work accounts</small></span>
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
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
            {error && <p className="mi-access-error" role="alert">{error}</p>}
          </div>
        </main>
      ) : null}
      {loading && (
        <p className="secure-empty" role="status">
          Loading your protected workspace…
        </p>
      )}
      {signedIn && error && <p role="alert">{error}</p>}
      {route && workspace && client && <PlatformApplication client={client} workspace={workspace} month={month} unsaved={unsaved}
        onUnsavedChange={setUnsaved} onDenied={onDenied} />}
      {!route && workspace && workspace.role !== "client" && client && <main id="platform-content" className="platform-workspace">
        <ProjectStaffWorkspace
          key={subject}
          client={client}
          tenant={import.meta.env.VITE_SECURE_TENANT_ID ?? ""}
          workspace={workspace}
          onUnsavedChange={setUnsaved}
          month={month}
          onDenied={onDenied}
        />
      </main>}
      {!route && workspace?.role === "client" && client && <main id="platform-content" className="platform-client-report">
        <ProjectClientReport
          key={subject}
          client={client}
          tenant={import.meta.env.VITE_SECURE_TENANT_ID ?? ""}
          month={month}
          onDenied={onDenied}
        />
      </main>}
      {signedIn && !workspace && error && !loading && (
        <button onClick={() => setRetry((value) => value + 1)}>
          Retry workspace
        </button>
      )}
    </section>
  );
}
