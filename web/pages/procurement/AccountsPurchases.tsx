import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../../api.js";
import { downloadDepartmentFile } from "../../download-file.js";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { PagedTableBody } from "../../ui/PagedTableBody.js";
import { fmtDay } from "./types.js";

interface PurchaseHandoff {
  id: string;
  number: string;
  title: string;
  warehouse: string;
  acknowledgedAt: string | null;
  forwardedAt: string | null;
  ptReference: string | null;
  ptDate: string | null;
  ptRecorded: boolean;
}

export function AccountsPurchases({ session }: { session: Session }) {
  const [rows, setRows] = useState<PurchaseHandoff[]>();
  const [selected, setSelected] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = "/procurement/accounts-queue";
  useEffect(() => {
    let active = true;
    api<{ rows: PurchaseHandoff[] }>(endpoint).then(result => {
      if (active) setRows(result.rows);
    }).catch(error => {
      if (active) setError(error instanceof ApiError ? error.message : "Unable to load approved purchases.");
    });
    return () => { active = false; };
  }, []);
  const purchase = rows?.find(row => row.id === selected);
  const canProcess = session.user.role === "Accounts";

  async function run(action: "download" | "acknowledge" | "pt" | "forward") {
    if (!purchase || pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const path = `/procurement/requests/${purchase.id}`;
      if (action === "download") {
        await downloadDepartmentFile(path + "/approved.pdf", `${purchase.number} approved RFQ.pdf`);
        return;
      }
      if (action === "pt") {
        await api("/accounts/pt-entries", { csrf: session.csrfToken, body: {
          sourceKind: "Procurement", sourceId: purchase.id, sourceVersion: 1,
          ptReference: reference.trim(), entryDate, notes: "",
        } });
      } else await api(path + "/accounts-action", { csrf: session.csrfToken, body: { action } });
      setRows((await api<{ rows: PurchaseHandoff[] }>(endpoint)).rows);
      setNotice(action === "forward" ? `${purchase.number} is in Inventory purchase receiving.`
        : action === "pt" ? "PT reference recorded." : "Approved purchase acknowledged.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to complete this action.");
    } finally {
      setPending(false);
    }
  }

  if (purchase) return <section className="pz-panel pz-stack">
    <div className="pz-action-row">
      <Button variant="neutral" disabled={pending} onClick={() => { setSelected(null); setNotice(""); setError(""); }}>Back to approved purchases</Button>
      <Button variant="secondary" loading={pending} onClick={() => void run("download")}>Download approved RFQ</Button>
    </div>
    <h3>{purchase.number} · {purchase.title}</h3>
    <p>Receiving warehouse <strong>{purchase.warehouse}</strong></p>
    {purchase.acknowledgedAt
      ? <p>Acknowledged {fmtDay(purchase.acknowledgedAt)}</p>
      : canProcess ? <div><Button variant="primary" loading={pending} onClick={() => void run("acknowledge")}>Acknowledge purchase</Button></div> : <p>Awaiting acknowledgement from Accounts</p>}
    {canProcess && purchase.acknowledgedAt && !purchase.ptRecorded && <form className="pz-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void run("pt"); }}>
      <div className="pz-form-grid">
        <Field id="supplier-purchase-pt-ref" label="PT reference (required)">
          <input id="supplier-purchase-pt-ref" value={reference} onChange={event => setReference(event.target.value)} maxLength={200} required />
        </Field>
        <Field id="supplier-purchase-pt-date" label="PT entry date (required)">
          <input id="supplier-purchase-pt-date" type="date" value={entryDate} onChange={event => setEntryDate(event.target.value)} required />
        </Field>
      </div>
      <div><Button variant="primary" type="submit" loading={pending}>Save PT reference</Button></div>
    </form>}
    {purchase.ptRecorded && <p>{purchase.ptReference ? <>PT reference <strong>{purchase.ptReference}</strong></> : "PT recorded"} · {fmtDay(purchase.ptDate)}</p>}
    {canProcess && purchase.ptRecorded && !purchase.forwardedAt && <div>
      <Button variant="primary" loading={pending} onClick={() => void run("forward")}>Send to Inventory receiving</Button>
    </div>}
    {purchase.forwardedAt && <p>Sent to Inventory {fmtDay(purchase.forwardedAt)}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;

  return <section className="pz-panel pz-stack">
    <h3>Approved supplier purchases</h3>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!rows && !error && <p role="status">Loading approved purchases…</p>}
    {rows?.length === 0 && <p>There are no approved purchases in this queue.</p>}
    {rows && rows.length > 0 && <div className="pz-table-scroll">
      <table>
        <thead><tr><th>SR#</th><th>Request / description</th><th>Warehouse</th><th>Status</th><th>Action</th></tr></thead>
        <PagedTableBody label="approved purchases">{rows.map((row, i) => <tr key={row.id}>
          <td>{i + 1}</td><td><strong>{row.number}</strong><small>{row.title}</small></td>
          <td>{row.warehouse}</td><td>{row.forwardedAt ? "Sent to Inventory" : row.ptRecorded ? "PT recorded" : row.acknowledgedAt ? "Awaiting PT" : "Awaiting acknowledgement"}</td>
          <td><Button variant="secondary" onClick={() => { setSelected(row.id); setReference(""); setEntryDate(""); }}>Open purchase</Button></td>
        </tr>)}</PagedTableBody>
      </table>
    </div>}
  </section>;
}
