import { useState, type FormEvent } from "react";
import { api, type Session } from "../api.js";

export function Login({
  onLogin,
  setupComplete,
  onRecover,
}: {
  onLogin: (s: Session) => void;
  setupComplete: boolean;
  onRecover: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Why the last session ended, e.g. after 30 minutes without activity (set by App on a 401).
  const [notice] = useState(() => {
    try { const m = sessionStorage.getItem("pz:signed-out") ?? ""; sessionStorage.removeItem("pz:signed-out"); return m; } catch { return ""; }
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<Session>("/auth/login", {
          body: {
            email: String(form.get("email")).trim(),
            password: form.get("password"),
          },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card" aria-labelledby="login-title">
      <span className="eyebrow">YOUR OPERATIONS WORKSPACE</span>
      <h1 id="login-title">Welcome back.</h1>
      <p className="intro">Sign in to continue to Power Zone.</p>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {setupComplete && (
        <p className="success" role="status">
          Administrator created. You can now sign in.
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          placeholder="you@company.com"
          required
          autoFocus
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          maxLength={128}
          required
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
            aria-controls="password"
            style={{ width: "auto", margin: 0 }}
          />
          Show password
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
          <span aria-hidden="true">→</span>
        </button>
      </form>
      <button type="button" onClick={onRecover}>
        Forgot password?
      </button>
      <p className="form-note">
        Access is available to authorised team members.
      </p>
    </section>
  );
}
