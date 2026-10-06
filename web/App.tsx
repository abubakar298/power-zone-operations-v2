import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Session } from "./api.js";
import { AuthLayout } from "./components/AuthLayout.js";
import { AccountLink } from "./pages/AccountLink.js";
import { Login } from "./pages/Login.js";
import { Setup } from "./pages/Setup.js";
import { Dashboard } from "./pages/Dashboard.js";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "setup" }
  | { kind: "login" }
  | { kind: "authenticated"; session: Session };
export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [linkPage, setLinkPage] = useState(
    window.location.pathname === "/account-link"
      ? "link"
      : window.location.pathname === "/forgot-password"
        ? "recover"
        : "",
  );
  const [setupComplete, setSetupComplete] = useState(false);
  const go = useCallback(
    (path: string) => window.history.replaceState(null, "", path),
    [],
  );
  const signedOut = useCallback(() => {
    setState({ kind: "login" });
    go("/login");
  }, [go]);
  async function load() {
    setState({ kind: "loading" });
    try {
      const status = await api<{ setupRequired: boolean }>("/auth/status");
      if (status.setupRequired) {
        setState({ kind: "setup" });
        go("/setup");
        return;
      }
      try {
        const session = await api<Session>("/auth/session");
        setState({ kind: "authenticated", session });
        go("/dashboard");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) signedOut();
        else throw err;
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unable to connect.",
      });
    }
  }
  useEffect(() => {
    if (!linkPage) void load();
  }, []);
  if (linkPage)
    return (
      <AuthLayout>
        <AccountLink
          recover={linkPage === "recover"}
          onBack={() => {
            setLinkPage("");
            void load();
          }}
        />
      </AuthLayout>
    );
  if (state.kind === "authenticated")
    return <Dashboard session={state.session} onLogout={signedOut} />;
  return (
    <AuthLayout>
      {state.kind === "loading" && (
        <section className="auth-card" role="status">
          <span className="eyebrow">POWER ZONE OPERATIONS</span>
          <h1>Opening your workspace…</h1>
        </section>
      )}
      {state.kind === "error" && (
        <section className="auth-card">
          <h1>Let’s reconnect.</h1>
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <button
            className="primary"
            onClick={() => {
              void load();
            }}
          >
            Try again
          </button>
        </section>
      )}
      {state.kind === "setup" && (
        <Setup
          onComplete={() => {
            setSetupComplete(true);
            signedOut();
          }}
        />
      )}
      {state.kind === "login" && (
        <Login
          onRecover={() => {
            setLinkPage("recover");
            go("/forgot-password");
          }}
          setupComplete={setupComplete}
          onLogin={(session) => {
            setState({ kind: "authenticated", session });
            go("/dashboard");
          }}
        />
      )}
    </AuthLayout>
  );
}
