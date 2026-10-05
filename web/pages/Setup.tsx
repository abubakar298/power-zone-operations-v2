import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.js';

export function Setup({ onComplete }: { onComplete: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirmPassword')) { setError('The passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/setup', { body: {
        displayName: data.get('displayName'), email: String(data.get('email')).trim(),
        password: data.get('password'), setupToken: data.get('setupToken'),
      } });
      onComplete();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { onComplete(); return; }
      setError(err instanceof Error ? err.message : 'Unable to complete setup.');
    } finally { setBusy(false); }
  }
  return <section className="auth-card setup-card" aria-labelledby="setup-title">
    <span className="eyebrow">FIRST TIME SETUP</span><h1 id="setup-title">Your workspace starts here.</h1>
    <p className="intro">Create the first administrator account.</p>
    <form onSubmit={submit}>
      <label htmlFor="displayName">Full name</label><input id="displayName" name="displayName" autoComplete="name" minLength={2} maxLength={100} required autoFocus />
      <label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required />
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} aria-describedby="password-hint" required />
      <small id="password-hint">Use at least 12 characters. A long, unique passphrase works well.</small>
      <label htmlFor="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
      <label htmlFor="setupToken">Setup key</label><input id="setupToken" name="setupToken" type="password" autoComplete="off" maxLength={256} aria-describedby="setup-hint" required />
      <small id="setup-hint">Use the setup key provided with your deployment.</small>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating administrator…' : 'Create administrator'}<span aria-hidden="true">→</span></button>
    </form>
  </section>;
}
