import {FileUpload} from '../ui/FileUpload.js';
import { useState } from "react";
import { api, type Session } from "../api.js";
import { confirmRevision } from "../confirm.js";
export function CustomerImport({
  session,
  onImported,
}: {
  session: Session;
  onImported: () => Promise<void>;
}) {
  const [input, setInput] = useState<any>(),
    [plan, setPlan] = useState<any>(),
    [backup, setBackup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function read(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPlan(undefined);
    setBackup(false);
    try {
      const rows = JSON.parse(await file.text());
      const v = {
        source:
          "https://docs.google.com/spreadsheets/d/18Nycq-ystofXIlT-4WhS-O6GILpIqfd7RAfEB85PKL4/edit",
        rows,
      };
      setInput(v);
      setPlan(
        await api("/masters/customer-import/preview", {
          body: v,
          csrf: session.csrfToken,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to read import file.");
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (
      !(await confirmRevision(
        "Import reviewed customers",
        "Update confirmed matches and add new customers. Ambiguous rows are held for review. Existing IDs, links and Mr. Arshad are retained.",
      ))
    )
      return;
    setBusy(true);
    setError("");
    try {
      setPlan(
        await api("/masters/customer-import/commit", {
          body: { input, fingerprint: plan.fingerprint, backupSaved: backup },
          csrf: session.csrfToken,
        }),
      );
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="detail-panel">
      <summary>Customer database import</summary>
      <p>
        Import reviewed six-field customer JSON. Blank cells preserve existing
        information. No customers are deleted. Mr. Arshad is protected.
      </p>
      <label>
        Customer import file
        <FileUpload onClear={()=>{setInput(undefined);setPlan(undefined);setBackup(false);setError('');}}
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {plan && (
        <>
          <p role="status">
            {plan.batchId ? "Import completed" : "Import preview"}:{" "}
            {plan.counts.added} added · {plan.counts.updated} updated ·{" "}
            {plan.counts.unchanged} unchanged · {plan.counts.needsReview} need
            review. {plan.retainedAbsent} existing customers absent from the
            sheet retained.
          </p>
          <p>
            Protected:{" "}
            {plan.protectedCustomers
              .map((c: any) => `${c.name} (ID ${c.id})`)
              .join(", ") || "Mr. Arshad not found; check before importing."}
          </p>
          <div className="order-table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th>Sheet row</th>
                  <th>Customer</th>
                  <th>Action</th>
                  <th>Existing ID</th>
                  <th>Review details</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r: any) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.source.name}</td>
                    <td>{r.action}</td>
                    <td>{r.id ?? "—"}</td>
                    <td>
                      {r.reason}{" "}
                      {r.candidates
                        ?.map((c: any) => `${c.id}: ${c.name}`)
                        .join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!plan.batchId && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={backup}
                  onChange={(e) => setBackup(e.target.checked)}
                />
                I downloaded and saved a fresh full encrypted backup.
              </label>
              <button disabled={busy || !backup} onClick={() => void commit()}>
                Import confirmed customers
              </button>
            </>
          )}
        </>
      )}
    </details>
  );
}
