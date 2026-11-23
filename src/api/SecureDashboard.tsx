import { Fingerprint, LockKeyhole, UserRound } from "lucide-react";
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
import { portalNavigate, usePlatformRoute, useReportingMonth } from "./portal-location";
import { PlatformApplication } from "./PlatformApplication";
import "./platform.css";
import "./platform-theme.css";
import { ThemeSelector, usePlatformTheme } from "./PlatformTheme";
import "../reporting/nordic.css";
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
  const month = useReportingMonth(today().slice(0, 7));
  const setMonth = (value: string) => portalNavigate({ month: value });
  const [nativeMonthPicker] = useState(() => {
    const input = document.createElement("input");
    input.type = "month";
    return input.type === "month";
  });
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
    <section className={"nordic secure-shell" + (route ? " platform-shell" : "")} data-theme={appearance}>
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
        <section className={"secure-sign-in" + (route ? " platform-sign-in" : "")} aria-label="Sign in">
          {route && <div className="mi-sign-in-story"><p><LockKeyhole size={16} aria-hidden="true" /> Protected reporting</p>
            <strong>Client Intelligence Platform</strong><span>Morris Interactive</span></div>}
          <div className={route ? "mi-sign-in-panel" : "mi-legacy-sign-in"}>
          {route && <Fingerprint size={28} aria-hidden="true" />}
          <h2>Sign in to your workspace</h2>
          <p>Clients use their approved Google account. Morris staff use their work Microsoft account.</p>
          <div className="secure-actions"><button disabled={!auth} onClick={() => void signIn("google")}>
            Sign in with Google
          </button>
          <button disabled={!auth} onClick={() => void signIn("microsoft")}>
            Sign in with Microsoft
          </button></div>
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
          {!route && <p>
            Morris staff use their Microsoft work account. Client accounts have
            read-only access to approved publications.
          </p>}</div>
        </section>
      ) : (
        <form className="secure-period" hidden={Boolean(route && route.kind !== "control")} onSubmit={event => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get("month") ?? "");
          if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
              (!unsaved || window.confirm("Discard the unsaved changes and change reporting month?"))) setMonth(value);
        }}>
          <label>
            Reporting month
            {nativeMonthPicker ? <input
              type="month"
              value={month}
              onChange={(e) => {
                if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) &&
                    (!unsaved || window.confirm("Discard the unsaved changes and change reporting month?")))
                  setMonth(e.target.value);
              }}
            /> : <input name="month" type="text" defaultValue={month} key={month}
              placeholder="YYYY-MM" pattern="[0-9]{4}-(0[1-9]|1[0-2])" required />}
          </label>
          {!nativeMonthPicker && <button type="submit">Apply month</button>}
        </form>
      )}
      {loading && (
        <p className="secure-empty" role="status">
          Loading your protected workspace…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {route && workspace && client && <PlatformApplication client={client} workspace={workspace} month={month} unsaved={unsaved}
        onUnsavedChange={setUnsaved} onDenied={onDenied} />}
      {!route && workspace && workspace.role !== "client" && client && (
        <ProjectStaffWorkspace
          key={subject}
          client={client}
          tenant={import.meta.env.VITE_SECURE_TENANT_ID ?? ""}
          workspace={workspace}
          onUnsavedChange={setUnsaved}
          month={month}
          onDenied={onDenied}
        />
      )}
      {!route && workspace?.role === "client" && client && (
        <ProjectClientReport
          key={subject}
          client={client}
          tenant={import.meta.env.VITE_SECURE_TENANT_ID ?? ""}
          month={month}
          onDenied={onDenied}
        />
      )}
      {signedIn && !workspace && error && !loading && (
        <button onClick={() => setRetry((value) => value + 1)}>
          Retry workspace
        </button>
      )}
    </section>
  );
}
