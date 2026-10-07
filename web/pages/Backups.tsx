import { useEffect, useState, type FormEvent } from "react";
import { api, type Session } from "../api.js";
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
  async function download(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
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
      if (!response.ok)
        throw new Error(
          (await response.json()).message ?? "Backup could not be prepared.",
        );
      const file = await response.blob(),
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
      <form onSubmit={download} className="backup-form">
        <label>
          Current administrator password
          <input
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
            aria-label="Backup encryption passphrase"
            type="password"
            autoComplete="new-password"
            required
            minLength={16}
            maxLength={128}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        <label>
          Confirm backup passphrase
          <input
            aria-label="Confirm backup passphrase"
            type="password"
            autoComplete="new-password"
            required
            minLength={16}
            maxLength={128}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
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
