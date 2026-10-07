import { money } from "../numbers.js";
import { confirmTransition } from "../confirm.js";
import { quotationTypeLabel } from "../../server/orders/sale-type.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
type Department = "Inventory" | "Accounts";
type RecordRow = {
  id: string;
  number: string;
  snapshot: any;
  division?: any;
  quotationType?: any;
  created_at: string;
  received_at?: string;
  sent_by?: string;
  stage_since: string;
  stage: string;
  version: number;
  notes: string | null;
};
const stages = {
  Inventory: [
    "Received BOQs",
    "Preparing stock",
    "Ready for dispatch",
    "Dispatched",
  ],
  Accounts: ["Received IPOs", "Review in progress", "Awaiting documents"],
};
const age = (date: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  return minutes >= 1440
    ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
    : minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes}m`;
};
export function Departments({
  session,
  department,
}: {
  session: Session;
  department: Department;
}) {
  const [records, setRecords] = useState<RecordRow[]>([]),
    [bucket, setBucket] = useState(stages[department][0]),
    [selected, setSelected] = useState<RecordRow>(),
    [history, setHistory] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [, tick] = useState(0);
  async function load() {
    const data = await api<{ records: RecordRow[] }>(
      `/departments/${department}`,
    );
    setRecords(data.records);
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setSelected(undefined);
    setBucket(stages[department][0]);
    void api<{ records: RecordRow[] }>(`/departments/${department}`)
      .then((d) => {
        if (active) {
          setRecords(d.records);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const timer = setInterval(() => tick((n) => n + 1), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [department]);
  async function open(row: RecordRow) {
    setSelected(row);
    setHistory([]);
    setError("");
    try {
      const d = await api<{ history: any[] }>(
        `/departments/${department}/${row.id}/history`,
      );
      setHistory(d.history);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const f = new FormData(e.currentTarget);
    if (
      !confirmTransition(
        "Update document progress",
        `${selected.number} will move to ${f.get("stage")}. The progress note will be recorded in its history.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/departments/${department}/checkpoints`, {
        csrf: session.csrfToken,
        body: {
          id: selected.id,
          version: selected.version,
          stage: f.get("stage"),
          notes: f.get("notes"),
          requestKey: crypto.randomUUID(),
        },
      });
      await load();
      setSelected(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const inventory = department === "Inventory",
    next = selected
      ? stages.Inventory[stages.Inventory.indexOf(selected.stage) + 1]
      : undefined;
  return (
    <section className="director-portal department-portal">
      <div className="section-heading">
        <div>
          <h2>{department} workspace</h2>
          <p>
            {inventory
              ? "Prepare the exact Store-issued requirements and track dispatch progress."
              : "Review received IPOs and prepare the supporting file for external accounting."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError("");
            void load().catch((e) => setError(e.message));
          }}
        >
          Refresh queues
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!loaded && !error && <p role="status">Loading documents…</p>}
      <div className="department-buckets">
        {stages[department].map((stage) => (
          <button
            key={stage}
            aria-pressed={bucket === stage}
            onClick={() => {
              setBucket(stage);
              setSelected(undefined);
            }}
          >
            <span>{stage}</span>
            <strong>{records.filter((r) => r.stage === stage).length}</strong>
          </button>
        ))}
      </div>
      <p className="field-hint">
        Stage age measures elapsed time since the latest recorded stage.
        Department targets have not been set.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              <th>Customer / site</th>
              <th>{inventory ? "Delivery date" : "Quotation"}</th>
              <th>Stage age</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records
              .filter((r) => r.stage === bucket)
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.number}
                    <br />
                    <small>
                      {quotationTypeLabel(r.quotationType ?? r.snapshot)}
                    </small>
                  </td>
                  <td>
                    {r.snapshot.customer?.name ?? "N/A"}
                    <br />
                    <small>{r.snapshot.siteName ?? "N/A"}</small>
                  </td>
                  <td>
                    {inventory
                      ? (r.snapshot.deliveryDate ?? "Not scheduled")
                      : r.snapshot.quotationNumber}
                  </td>
                  <td>{age(r.stage_since)}</td>
                  <td>
                    <button onClick={() => void open(r)}>Open document</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {loaded && !records.some((r) => r.stage === bucket) && (
        <p className="field-hint">No documents in this bucket.</p>
      )}
      {selected && (
        <article className="department-detail">
          <h3>
            {selected.number} · {selected.stage}
          </h3>
          <p>
            {selected.snapshot.customer?.name} · {selected.snapshot.siteName}
          </p>
          <p>
            <strong>Quotation type:</strong>{" "}
            {quotationTypeLabel(selected.quotationType ?? selected.snapshot)}
          </p>
          {!inventory && selected.received_at && (
            <p>
              Received from {selected.sent_by} ·{" "}
              {new Date(selected.received_at).toLocaleString()}
            </p>
          )}
          {inventory ? (
            <>
              <p>
                <strong>Delivery:</strong>{" "}
                {selected.snapshot.deliveryAddress || "N/A"}
                <br />
                {selected.snapshot.deliveryDate}{" "}
                {selected.snapshot.deliveryTime}
                <br />
                <strong>Site contact:</strong> {selected.snapshot.siteContact} ·{" "}
                {selected.snapshot.sitePhone}
                <br />
                <strong>Instructions:</strong>{" "}
                {selected.snapshot.notes || "None"}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item / specification</th>
                      <th>Brand</th>
                      <th>Required quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.snapshot.items?.map((i: any, n: number) => (
                      <tr key={n}>
                        <td>
                          {i.name ?? i.item ?? i.key}
                          <br />
                          <small>{i.specification}</small>
                        </td>
                        <td>{i.brand}</td>
                        <td>
                          {i.qty} {i.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <a
                target="_blank"
                rel="noreferrer"
                href={`/api/operations/store/${selected.id}/report.pdf`}
              >
                Download issued BOQ
              </a>
              <p className="field-hint">
                These are required quantities, not stock available. Recording
                dispatch does not post inventory movements.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>Customer PO:</strong>{" "}
                {selected.snapshot.input?.poNumber || "N/A"}
              </p>
              <p>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`/api/orders/${selected.id}/ipo.pdf`}
                >
                  Download IPO &amp; Peachtree PDF
                </a>
              </p>
              {selected.division && (
                <>
                  <h4>Peachtree phase division</h4>
                  <p>
                    {selected.division.basis} · Discount allocated from the
                    accepted quotation.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Phase</th>
                        <th>Selling amount (PKR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.division.phases.map((p: any) => (
                        <tr key={p.name}>
                          <td>{p.name}</td>
                          <td>
                            {money(p.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    <strong>Phase total:</strong> {selected.division.phaseTotal}{" "}
                    · <strong>IPO tax:</strong>{" "}
                    {selected.division.taxMode === "Tax Included"
                      ? "0.00"
                      : selected.division.ipoTax}{" "}
                    · <strong>Payable:</strong> {selected.division.ipoPayable}
                  </p>
                </>
              )}
              <h4>Supporting documents to collect</h4>
              <ul>
                <li>Customer sign-off</li>
                <li>Customer-signed delivery orders</li>
                <li>Site photographs</li>
                <li>Inventory installation report and any required revision</li>
              </ul>
              <p className="field-hint">
                This list is a requirement checklist; document receipt has not
                been verified. Keep missing documents and source references in
                the review note.
              </p>
            </>
          )}
          {(!inventory || next) && (
            <form key={selected.id + selected.version} onSubmit={save}>
              <label>
                Next stage
                <select name="stage">
                  {!inventory && selected.received_at && (
                    <p>
                      Received from {selected.sent_by} ·{" "}
                      {new Date(selected.received_at).toLocaleString()}
                    </p>
                  )}
                  {inventory ? (
                    <option>{next}</option>
                  ) : (
                    stages.Accounts.slice(1).map((s) => (
                      <option key={s}>{s}</option>
                    ))
                  )}
                </select>
              </label>
              <label>
                {inventory && next === "Dispatched"
                  ? "Dispatch reference and progress note"
                  : "Progress note / missing documents"}
                <textarea
                  name="notes"
                  required
                  maxLength={2000}
                  placeholder="Record what happened, outstanding work and relevant document references."
                />
              </label>
              <button disabled={busy}>
                {busy ? "Saving…" : "Record progress"}
              </button>
            </form>
          )}
          <h4>Progress history</h4>
          {history.length ? (
            history.map((h) => (
              <p key={h.version}>
                <strong>{h.stage}</strong> · {h.recorded_by} ·{" "}
                {new Date(h.created_at).toLocaleString()}
                <br />
                {h.notes}
              </p>
            ))
          ) : (
            <p>No progress recorded yet.</p>
          )}
        </article>
      )}
      <div className="department-roadmap">
        <h3>
          {inventory ? "Returns and stock control" : "Downstream accounting"}
        </h3>
        {inventory ? (
          <p>
            Expected unused-stock returns and physical receipts will be tracked
            separately in the inventory milestone. No stock-on-hand balances or
            return quantities are assumed here. Procurement is a later module.
          </p>
        ) : (
          <p>
            Invoicing and actual project costing remain in Peachtree. Budget
            comparison and Director job-closing requests will be connected after
            the supporting-document and actual-cost workflow is defined.
          </p>
        )}
      </div>
    </section>
  );
}
