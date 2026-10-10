import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { money, decimalDisplay } from "../numbers.js";
import { Departments } from "./Departments.js";
import {
  reconcile,
  type ReportEntry,
  type InventoryLine,
} from "../../server/inventory/reconciliation.js";
import { confirmTransition } from "../confirm.js";
const empty: ReportEntry = {
  start: "",
  end: "",
  panelCount: "",
  panelWattage: "",
  usage: {},
  remarks: "",
  expectedReturns: "",
  receivedReturns: "",
  extra: [],
};
const buckets = [
  "BOQs Received",
  "Stock & Procurement Actions",
  "Deliveries Due",
  "Dispatch Confirmation Pending",
  "Gate-In & Returns",
  "IRR Received",
];
export function InventoryWorkspace({
  session,
  accounts = false,
  receiveOnly = false,
}: {
  session: Session;
  accounts?: boolean;
  receiveOnly?: boolean;
}) {
  const [tab, setTab] = useState(
      accounts ? "Receipts & Reconciliation" : "My Workspace",
    ),
    [bucket, setBucket] = useState(""),
    [search, setSearch] = useState(""),
    [overdue, setOverdue] = useState(false),
    [jobs, setJobs] = useState<any[]>([]),
    [records, setRecords] = useState<any[]>([]),
    [reports, setReports] = useState<any[]>([]),
    [job, setJob] = useState<any>(),
    [entry, setEntry] = useState<ReportEntry>(empty),
    [report, setReport] = useState<any>(),
    [detail, setDetail] = useState<any>(),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [legacy, setLegacy] = useState(false),
    [legacyId, setLegacyId] = useState<string>(),
    [loaded, setLoaded] = useState(false),
    [savedEntry, setSavedEntry] = useState("");
  const dirty = !!job && JSON.stringify(entry) !== savedEntry;
  useUnsavedChanges(dirty);
  const ops = receiveOnly || session.user.role === "Operations",
    readOnly = accounts || report?.stage === "Sent to Accounts";
  async function load() {
    const data = await Promise.all([
      api<any>("/inventory-reconciliation/jobs"),
      api<any>("/inventory-reconciliation/reports"),
      ...(accounts || ops ? [] : [api<any>("/departments/Inventory")]),
    ]);
    setJobs(data[0].jobs);
    setReports(data[1].reports);
    setRecords(data[2]?.records ?? []);
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  function cleanNavigate(next: string) {
    if (
      dirty &&
      !readOnly &&
      !window.confirm(
        "Leave this report? Save a draft first to retain your changes.",
      )
    )
      return;
    setTab(next);
    setJob(undefined);
    setLegacy(false);
    setError("");
    setMessage("");
  }
  async function openJob(key: string) {
    setBusy(true);
    setError("");
    try {
      const j = await api<any>(
        "/inventory-reconciliation/job?key=" + encodeURIComponent(key),
      );
      const saved = reports.find((r) => r.job_key === key);
      let e = structuredClone(empty),
        d: any;
      if (saved) {
        d = await api<any>("/inventory-reconciliation/reports/" + saved.id);
        e = d.versions[0].snapshot.entry;
      }
      setJob(d?.versions[0]?.snapshot ?? j);
      setEntry(e);
      setSavedEntry(JSON.stringify(e));
      setReport(saved);
      setDetail(d);
      setReview(accounts || saved?.stage === "Sent to Accounts");
      setLegacy(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(stage: string) {
    if (!job || busy) return;
    if (
      stage === "Sent to Accounts" &&
      !confirmTransition(
        "Send reconciliation to Accounts",
        `${job.jobId}: the saved report becomes read-only. This does not approve invoice changes or close the job.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<any>("/inventory-reconciliation/reports", {
        csrf: session.csrfToken,
        body: {
          jobKey: job.key,
          version: report?.version ?? 0,
          stage,
          entry,
          requestKey: crypto.randomUUID(),
        },
      });
      setReport({
        id: result.reportId,
        version: result.version,
        stage,
        job_key: job.key,
      });
      setDetail(
        await api<any>("/inventory-reconciliation/reports/" + result.reportId),
      );
      await load();
      setSavedEntry(JSON.stringify(entry));
      setMessage(
        stage === "Sent to Accounts"
          ? "Sent to Accounts. Invoice adjustments await review and approval."
          : "Report saved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (!report) {
      setError("Save a draft before attaching the report.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Attachment must be 8 MB or smaller.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const f = new FileReader();
        f.onload = () => resolve(String(f.result).split(",")[1]);
        f.onerror = () => reject(new Error("Unable to read attachment."));
        f.readAsDataURL(file);
      });
      await api("/inventory-reconciliation/reports/" + report.id + "/files", {
        csrf: session.csrfToken,
        body: { filename: file.name, mediaType: file.type, base64: data },
      });
      setDetail(
        await api<any>("/inventory-reconciliation/reports/" + report.id),
      );
      await load();
      setMessage("Attachment saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function update(key: keyof ReportEntry, value: any) {
    setEntry((old) => ({ ...old, [key]: value }));
    setMessage("");
  }
  const filteredJobs = jobs.filter((j) =>
    `${j.job_id} ${j.site_name} ${j.branch_code}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const tasks = [
    ...records
      .filter((r) => r.stage !== "Dispatched")
      .map((r) => {
        const b =
          r.stage === "Received BOQs"
            ? "BOQs Received"
            : r.stage === "Preparing stock"
              ? "Stock & Procurement Actions"
              : "Deliveries Due";
        const due = r.snapshot.deliveryDate;
        return {
          ...r,
          kind: "boq",
          bucket: b,
          title: r.snapshot.siteName,
          jobId: r.snapshot.ipoNumber || r.number,
          due,
          overdue:
            !!due && new Date(due + "T23:59:59+05:00").getTime() < Date.now(),
          action: "Open BOQ",
        };
      }),
    ...reports
      .filter(
        (r) =>
          r.stage !== "Sent to Accounts" &&
          (r.stage !== "IRR Received" || r.has_files),
      )
      .map((r) => ({
        ...r,
        kind: "irr",
        bucket: "IRR Received",
        title: r.site_name,
        jobId: r.job_id,
        due: null,
        overdue: false,
        action:
          r.stage === "IRR Received"
            ? "Enter installation report"
            : "Continue reconciliation",
      })),
  ];
  const visible = tasks.filter(
    (t) =>
      (!bucket || t.bucket === bucket) &&
      (!overdue || t.overdue) &&
      `${t.title} ${t.jobId} ${t.number ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const reconciliation = job ? reconcile(job.lines, entry) : null;
  const attachmentLinks = detail?.files.map((f: any) => (
    <li key={f.id}>
      <a href={"/api/inventory-reconciliation/files/" + f.id}>{f.filename}</a>
    </li>
  ));
  return (
    <section className="pz-inventory">
      <div className="pz-action-row">
        {(accounts
          ? ["Receipts & Reconciliation"]
          : ops
            ? ["IRR Upload"]
            : [
                "My Workspace",
                "Stock & Warehouses",
                "Delivery Orders",
                "Receipts & Reconciliation",
              ]
        ).map((t) => (
          <Button
            key={t}
            variant={tab === t ? "secondary" : "neutral"}
            aria-pressed={tab === t}
            onClick={() => cleanNavigate(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <h2>
        {accounts
          ? "Installation reconciliations received"
          : ops
            ? "Operations installation report handoff"
            : tab}
      </h2>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!loaded && !error && <p role="status">Loading Inventory records…</p>}
      {job ? (
        <article className="detail-panel pz-irr-report">
          <div className="section-heading">
            <div>
              <h3>
                {job.jobId} · {job.title}
              </h3>
              <p>
                {job.source.configuration ?? job.source.kind} ·{" "}
                {report?.stage ?? "New installation report"}
              </p>
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                if (
                  dirty &&
                  !readOnly &&
                  !confirmTransition(
                    "Back to workspace",
                    "Unsaved edits will be discarded.",
                  )
                )
                  return;
                setJob(undefined);
              }}
            >
              Back to workspace
            </Button>
          </div>
          {review && reconciliation ? (
            <>
              <h3>Installation reconciliation report</h3>
              <p>
                {entry.start || "Start not entered"} →{" "}
                {entry.end || "Completion not entered"} ·{" "}
                {reconciliation.watts
                  ? decimalDisplay(reconciliation.watts, 0) + " W installed"
                  : "Installed wattage not entered"}
              </p>
              {reconciliation.sections.map((s) => (
                <section key={s.group}>
                  <h3>
                    {s.group === "watt"
                      ? "Per-watt billing adjustment"
                      : s.group === "cable"
                        ? "Cable reconciliation · MTRS"
                        : "Other materials"}
                  </h3>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>UOM</th>
                          <th>BOQ qty</th>
                          <th>Installed qty</th>
                          <th>Qty change</th>
                          <th>Rate without GST</th>
                          <th>Amount value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.rows.map((l) => (
                          <tr key={l.key}>
                            <td>{l.description}</td>
                            <td className="pz-uom">{l.unit}</td>
                            <td className="pz-number">
                              {decimalDisplay(l.approved)}
                            </td>
                            <td className="pz-number">
                              {decimalDisplay(l.installed)}
                            </td>
                            <td className="pz-number">
                              {decimalDisplay(l.change)}
                            </td>
                            <td className="pz-number">
                              {money(l.sellingRate)}
                            </td>
                            <td className="pz-number">
                              {l.value === null && l.change === "0"
                                ? "0.00"
                                : money(l.value)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th colSpan={6}>
                            {s.complete ? "" : "Known "}Net{" "}
                            {s.group === "cable"
                              ? "cable balance"
                              : "adjustment"}{" "}
                            excluding GST
                          </th>
                          <td className="pz-number">{money(s.net)}</td>
                        </tr>
                        {s.taxes.map((t) => (
                          <tr key={t.rate}>
                            <th colSpan={6}>GST @ {t.rate}%</th>
                            <td className="pz-number">{money(t.amount)}</td>
                          </tr>
                        ))}
                        <tr>
                          <th colSpan={6}>Balance including GST</th>
                          <td className="pz-number">{money(s.gross)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {!s.complete && (
                    <p>
                      Usage or selling rates remain unconfirmed. Accounts must
                      resolve them before invoicing.
                    </p>
                  )}
                </section>
              ))}
              <h3>Grand net balance</h3>
              <div className="table-scroll">
                <table>
                  <tbody>
                    <tr>
                      <th>
                        {reconciliation.complete ? "" : "Known "}balance without
                        GST
                      </th>
                      <td className="pz-number">{money(reconciliation.net)}</td>
                    </tr>
                    <tr>
                      <th>GST adjustment</th>
                      <td className="pz-number">{money(reconciliation.gst)}</td>
                    </tr>
                    <tr>
                      <th>Balance with GST</th>
                      <td className="pz-number">
                        {money(reconciliation.gross)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                {job.rateBasis} · {reconciliation.status}
              </p>
              <h3>Additional materials</h3>
              {entry.extra.length ? (
                entry.extra.map((e, i) => (
                  <p key={i}>
                    {e.description} · {e.used} {e.unit} · Accounts review
                    required
                  </p>
                ))
              ) : (
                <p>None entered.</p>
              )}
              <p>Remarks: {entry.remarks || "None entered"}</p>
              <p>Expected returns: {entry.expectedReturns || "None entered"}</p>
              <p>
                Physical receipt references:{" "}
                {entry.receivedReturns || "None entered"}
              </p>
              <ul>{attachmentLinks}</ul>
              <div className="pz-action-row">
                <Button
                  onClick={() => {
                    document.body.classList.add("pz-print-irr");
                    const cleanup = () => {
                      document.body.classList.remove("pz-print-irr");
                      window.removeEventListener("afterprint", cleanup);
                    };
                    window.addEventListener("afterprint", cleanup);
                    window.print();
                  }}
                >
                  Print reconciliation
                </Button>
                {!readOnly && (
                  <>
                    <Button onClick={() => setReview(false)}>Edit entry</Button>
                    <Button
                      variant="primary"
                      loading={busy}
                      onClick={() => void save("Sent to Accounts")}
                    >
                      Send to Accounts
                    </Button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="pz-form-grid">
                <Field id="irr-start" label="Installation start">
                  <input
                    id="irr-start"
                    type="date"
                    value={entry.start}
                    onChange={(e) => update("start", e.target.value)}
                  />
                </Field>
                <Field id="irr-end" label="Installation completion">
                  <input
                    id="irr-end"
                    type="date"
                    value={entry.end}
                    onChange={(e) => update("end", e.target.value)}
                  />
                </Field>
                {job.lines.some((l: InventoryLine) => l.group === "watt") && (
                  <>
                    <Field id="irr-panels" label="Installed panel quantity">
                      <input
                        id="irr-panels"
                        type="number"
                        min="1"
                        step="1"
                        value={entry.panelCount}
                        onChange={(e) => update("panelCount", e.target.value)}
                      />
                    </Field>
                    <Field id="irr-watts" label="Watts per panel">
                      <input
                        id="irr-watts"
                        type="number"
                        min="1"
                        value={entry.panelWattage}
                        onChange={(e) => update("panelWattage", e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
              {(["cable", "material"] as const).map((group) => (
                <section key={group}>
                  <h3>
                    {group === "cable"
                      ? "Cable usage · MTRS"
                      : "Major BOQ materials"}
                  </h3>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Material / specification</th>
                          <th>UOM</th>
                          <th>BOQ quantity</th>
                          <th>Installed / used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.lines
                          .filter((l: InventoryLine) => l.group === group)
                          .map((l: InventoryLine) => (
                            <tr key={l.key}>
                              <td>
                                {l.description}
                                <small>
                                  {l.brand} {l.specification}
                                </small>
                              </td>
                              <td className="pz-uom">{l.unit}</td>
                              <td className="pz-number">
                                {decimalDisplay(l.approved)}
                              </td>
                              <td>
                                <input
                                  aria-label={
                                    l.description + " installed quantity"
                                  }
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={entry.usage[l.key] ?? ""}
                                  onChange={(e) =>
                                    update("usage", {
                                      ...entry.usage,
                                      [l.key]: e.target.value,
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
              <h3>Other materials</h3>
              {entry.extra.map((e, i) => (
                <div className="pz-form-grid" key={i}>
                  <input
                    aria-label="Additional material"
                    placeholder="Description"
                    value={e.description}
                    onChange={(v) =>
                      update(
                        "extra",
                        entry.extra.map((x, n) =>
                          n === i ? { ...x, description: v.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Additional material unit"
                    placeholder="UOM"
                    value={e.unit}
                    onChange={(v) =>
                      update(
                        "extra",
                        entry.extra.map((x, n) =>
                          n === i ? { ...x, unit: v.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label="Additional quantity"
                    type="number"
                    min="0"
                    value={e.used}
                    onChange={(v) =>
                      update(
                        "extra",
                        entry.extra.map((x, n) =>
                          n === i ? { ...x, used: v.target.value } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    onClick={() =>
                      update(
                        "extra",
                        entry.extra.filter((_, n) => n !== i),
                      )
                    }
                  >
                    Remove line
                  </Button>
                </div>
              ))}
              <Button
                onClick={() =>
                  update("extra", [
                    ...entry.extra,
                    { description: "", unit: "NOS", used: "" },
                  ])
                }
              >
                Add other material
              </Button>
              <div className="pz-form-grid">
                <Field id="irr-return" label="Expected returns">
                  <textarea
                    id="irr-return"
                    value={entry.expectedReturns}
                    onChange={(e) => update("expectedReturns", e.target.value)}
                  />
                </Field>
                <Field
                  id="irr-physical"
                  label="Physical return receipt references"
                  hint="This report does not post stock receipts."
                >
                  <textarea
                    id="irr-physical"
                    value={entry.receivedReturns}
                    onChange={(e) => update("receivedReturns", e.target.value)}
                  />
                </Field>
              </div>
              <Field id="irr-remarks" label="Remarks">
                <textarea
                  id="irr-remarks"
                  value={entry.remarks}
                  onChange={(e) => update("remarks", e.target.value)}
                />
              </Field>
              <Field
                id="irr-file"
                label="Installation report / evidence"
                hint="Save a draft first. PDF, PNG or JPEG; 8 MB maximum."
              >
                <input
                  id="irr-file"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={!report || busy}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void upload(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
              </Field>
              <ul>{attachmentLinks}</ul>
              <p>
                AI Review will be added later. Enter and verify report
                quantities manually.
              </p>
              <div className="pz-action-row">
                <Button
                  loading={busy}
                  variant="secondary"
                  onClick={() =>
                    void save(ops ? "IRR Received" : "Draft Reconciliation")
                  }
                >
                  {ops ? "Upload to IRR Received" : "Save draft"}
                </Button>
                {!ops && (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      try {
                        reconcile(job.lines, entry);
                        setReview(true);
                      } catch {
                        setError("Check the entered quantities.");
                      }
                    }}
                  >
                    Create reconciliation report
                  </Button>
                )}
              </div>
            </>
          )}
          {detail && (
            <details>
              <summary>Version history</summary>
              {detail.versions.map((v: any) => (
                <p key={v.id}>
                  V{v.version} · {v.stage} · {v.recorded_by} ·{" "}
                  {new Date(v.created_at).toLocaleString("en-PK", {
                    timeZone: "Asia/Karachi",
                  })}
                </p>
              ))}
            </details>
          )}
        </article>
      ) : (
        <>
          {!accounts && !ops && tab === "My Workspace" && (
            <>
              <div className="department-buckets">
                {buckets.map((b) => (
                  <Button
                    key={b}
                    aria-pressed={bucket === b}
                    onClick={() => setBucket(bucket === b ? "" : b)}
                  >
                    <span>{b}</span>
                    <strong>
                      {tasks.filter((t) => t.bucket === b).length}
                    </strong>
                  </Button>
                ))}
              </div>
              <div className="pz-action-row">
                <input
                  aria-label="Search Job ID or site"
                  placeholder="Job ID, site or document"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select
                  aria-label="Stage"
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                >
                  <option value="">All stages</option>
                  {buckets.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={overdue}
                    onChange={(e) => setOverdue(e.target.checked)}
                  />{" "}
                  Overdue deliveries only
                </label>
              </div>
              <h3>My Next Actions</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Job / Site</th>
                      <th>Stage</th>
                      <th>Delivery due</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.jobId}
                          <br />
                          {t.title}
                        </td>
                        <td>{t.bucket}</td>
                        <td>
                          {t.overdue ? "Overdue · " : ""}
                          {t.due ?? "No due date set"}
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              if (t.kind === "irr") void openJob(t.job_key);
                              else {
                                setLegacyId(t.id);
                                setLegacy(true);
                              }
                            }}
                          >
                            {t.action}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visible.length && <p>No matching pending tasks.</p>}
              <p className="pz-caption">
                Stock reservations, procurement requests, warehouse receipts and
                signed DO dispatch are not yet connected. No stock balances or
                dispatch counts are inferred.
              </p>
            </>
          )}
          {tab === "Stock & Warehouses" && (
            <section className="detail-panel">
              <h3>Stock & Warehouses</h3>
              <p>
                Warehouse opening balances and stock movements have not been
                entered. Physical, reserved and available balances will appear
                after the stock ledger milestone.
              </p>
              <p>Warehouse transfers remain separate from site deliveries.</p>
            </section>
          )}
          {tab === "Delivery Orders" && (
            <section className="detail-panel">
              <h3>BOQ preparation records</h3>
              <p>
                The existing preparation checkpoints remain below. They do not
                issue a DO or deduct physical stock.
              </p>
              <p>
                Signed gatekeeper evidence and warehouse-specific DO issuance
                will be connected in the dispatch milestone.
              </p>
              <Departments session={session} department="Inventory" />
            </section>
          )}
          {(tab === "Receipts & Reconciliation" || ops) && (
            <>
              <p>
                Installation Reconciliation ·{" "}
                {accounts
                  ? "Read submitted reports from Inventory."
                  : "Enter an IRR by Job ID or select a received report."}
              </p>
              {!accounts && (
                <>
                  <label htmlFor="irr-job-search">Search Job ID or site</label>
                  <input
                    id="irr-job-search"
                    placeholder="CHP-320 / Adda Jahan"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Job ID</th>
                          <th>Site</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredJobs.slice(0, 50).map((j) => (
                          <tr key={j.key}>
                            <td>{j.job_id}</td>
                            <td>{j.site_name}</td>
                            <td>
                              <Button
                                disabled={busy}
                                onClick={() => void openJob(j.key)}
                              >
                                Enter installation report
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div className="pz-action-row">
                {[
                  "IRR Received",
                  "Draft Reconciliation",
                  "Sent to Accounts",
                ].map((b) => (
                  <Button
                    key={b}
                    aria-pressed={bucket === b}
                    onClick={() => setBucket(bucket === b ? "" : b)}
                  >
                    {b} ·{" "}
                    {
                      reports.filter(
                        (r) =>
                          r.stage === b &&
                          (b !== "IRR Received" || r.has_files),
                      ).length
                    }
                  </Button>
                ))}
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Job / Site</th>
                      <th>Stage</th>
                      <th>Received / saved</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports
                      .filter(
                        (r) =>
                          (!accounts || r.stage === "Sent to Accounts") &&
                          (!bucket || r.stage === bucket) &&
                          `${r.job_id} ${r.site_name}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.job_id}
                            <br />
                            {r.site_name}
                          </td>
                          <td>
                            {r.stage === "IRR Received" && !r.has_files
                              ? "Awaiting attachment"
                              : r.stage}
                          </td>
                          <td>
                            {new Date(r.created_at).toLocaleString("en-PK", {
                              timeZone: "Asia/Karachi",
                            })}
                          </td>
                          <td>
                            <Button onClick={() => void openJob(r.job_key)}>
                              Open report
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!reports.length && <p>No installation reports received yet.</p>}
              <p>
                Purchase Gate-In and physical Site Returns will be added with
                the stock ledger.
              </p>
            </>
          )}
          {legacy && (
            <Departments
              session={session}
              department="Inventory"
              initialRecordId={legacyId}
            />
          )}
        </>
      )}
    </section>
  );
}
