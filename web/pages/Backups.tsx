import { useEffect, useState, type FormEvent } from "react";
import { api, type Session } from "../api.js";
import { readBackupResponse } from "../backup-response.js";
export function Backups({ session }: { session: Session }) {
  const [password, setPassword] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [downloads, setDownloads] = useState<{ created_at: string }[]>([]);
  const refresh = () =>
    api<{ downloads: { created_at: string }[] }>("/backups")
      .then((r) => setDownloads(r.downloads))
      .catch(() => {});
  useEffect(() => {
    void refresh();
  }, []);
  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") ?? "");
    const passphrase = String(fields.get("passphrase") ?? "");
    const confirm = String(fields.get("passphraseConfirmation") ?? "");
    setError("");
    setMessage("");
    if (!password) {
      setError("Enter your current administrator password.");
      return;
    }
    if (passphrase.length < 16 || passphrase.length > 128) {
      setError(
        `Backup encryption passphrase has ${passphrase.length} characters. Enter 16–128 characters.`,
      );
      return;
    }
    if (confirm.length < 16 || confirm.length > 128) {
      setError(
        `Confirm backup passphrase has ${confirm.length} characters. Enter the same 16–128 character passphrase again.`,
      );
      return;
    }
    if (passphrase !== confirm) {
      setError("Backup passphrases do not match.");
      return;
    }
    if (
      !window.confirm(
        "Download an encrypted full application backup? It contains private company records and uploaded documents. Keep it and its passphrase safely in separate places.",
      )
    )
      return;
    setBusy(true);
    try {
      const response = await fetch("/api/backups/download", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({
          password,
          passphrase,
          passphraseConfirmation: confirm,
        }),
      });
      const file = await readBackupResponse(response),
        url = URL.createObjectURL(file),
        link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "Power-Zone-Backup.pzb";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage(
        "Backup prepared and download started. Confirm the .pzb file is saved, then copy it to your external disk. This does not run automatically each day.",
      );
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Backup failed. Please try again.",
      );
    } finally {
      setBusy(false);
      setPassword("");
      setPassphrase("");
      setConfirm("");
    }
  }
  return (
    <section className="backup-panel">
      <h3>Encrypted database backups</h3>
      <p>
        Download customers, master data, documents, uploaded files and workflow
        history for recovery. Administrator only. Existing login sessions and
        email links are excluded.
      </p>
      <p>
        Manual daily routine: download, confirm the file saved, and copy it to
        your external disk. Keep the backup passphrase separately; a lost
        passphrase cannot be recovered. Restoration requires an operator and a
        separate empty database.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <form noValidate onSubmit={download} className="backup-form">
        <label>
          Current administrator password
          <input
            name="password"
            aria-label="Backup administrator password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Backup encryption passphrase
          <input
            name="passphrase"
            aria-label="Backup encryption passphrase"
            type="password"
            autoComplete="new-password"
            required
            minLength={16}
            maxLength={128}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <small aria-live="polite">
            Backup passphrase: {passphrase.length} characters · minimum 16
          </small>
        </label>
        <label>
          Confirm backup passphrase
          <input
            name="passphraseConfirmation"
            aria-label="Confirm backup passphrase"
            type="password"
            autoComplete="new-password"
            required
            minLength={16}
            maxLength={128}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <small aria-live="polite">
            Confirmation: {confirm.length} characters ·{" "}
            {confirm === passphrase && confirm.length > 0
              ? "matches"
              : "must match the backup passphrase"}
          </small>
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Preparing encrypted backup…" : "Download encrypted backup"}
        </button>
      </form>
      <h4>Recently prepared downloads</h4>
      <p>
        Preparation time does not confirm that a file was saved to your disk.
      </p>
      {downloads.length ? (
        <ul>
          {downloads.map((d, i) => (
            <li key={i}>{new Date(d.created_at).toLocaleString()}</li>
          ))}
        </ul>
      ) : (
        <p>No backups prepared yet.</p>
      )}
    </section>
  );
}
