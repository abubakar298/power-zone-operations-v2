import { useState, type FormEvent } from "react";
import { api } from "../api.js";
export function AccountLink({
  recover = false,
  onBack,
}: {
  recover?: boolean;
  onBack: () => void;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [link] = useState(() => {
    const [purpose, token] = window.location.hash.slice(1).split("/");
    window.history.replaceState(null, "", "/account-link");
    return { purpose, token };
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    if (
      !recover &&
      link.purpose !== "verify" &&
      f.get("password") !== f.get("confirm")
    ) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>(
        recover ? "/accounts/recover" : "/accounts/consume",
        {
          body: recover
            ? { email: f.get("email") }
            : {
                ...link,
                ...(link.purpose !== "verify"
                  ? { password: f.get("password") }
                  : {}),
                ...(link.purpose === "invite"
                  ? { displayName: f.get("displayName") }
                  : {}),
              },
        },
      );
      setMessage(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">POWER ZONE ACCOUNT ACCESS</span>
      <h1>
        {recover
          ? "Reset your password."
          : link.purpose === "invite"
            ? "Join your team."
            : link.purpose === "verify"
              ? "Verify your email."
              : "Choose a new password."}
      </h1>
      {message ? (
        <p role="status" className="success">
          {message}
        </p>
      ) : (
        <form onSubmit={submit}>
          {recover ? (
            <>
              <label>
                Email address
                <input
                  name="email"
                  aria-label="Email address"
                  type="email"
                  required
                  maxLength={254}
                />
              </label>
            </>
          ) : (
            <>
              {link.purpose === "invite" && (
                <label>
                  Your name
                  <input
                    name="displayName"
                    aria-label="Your name"
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </label>
              )}
              {link.purpose !== "verify" && (
                <>
                  <label>
                    New password
                    <input
                      name="password"
                      aria-label="New password"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    Confirm password
                    <input
                      name="confirm"
                      aria-label="Confirm password"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Processing…"
              : recover
                ? "Request reset email"
                : "Continue"}
          </button>
        </form>
      )}
      <button onClick={onBack}>Back to sign in</button>
    </section>
  );
}
