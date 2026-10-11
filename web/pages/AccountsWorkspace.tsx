import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { money } from "../numbers.js";
import { InventoryWorkspace } from "./InventoryWorkspace.js";
import { Departments } from "./Departments.js";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
import { confirmTransition } from "../confirm.js";
import { quotationDisplayRows } from "../../server/commercial/quotation-rows.js";
import { orderCustomerScopeLines } from "../../server/commercial/customer-scope.js";
import { DocumentPreview } from "../components/DocumentPreview.js";
import {
  ClosureCostTables,
  ClosureIndicators,
  installationDays,
} from "../components/ClosurePerformance.js";
import { Decimal } from "decimal.js";
const phases = ["Solar Panels", "Structure", "Inverter", "Batteries", "BMS"];
const epcNames = [
  "Electrical Labour",
  "Earthing Cost",
  "Deliveries",
  "Installation Cost",
];
export function AccountsWorkspace({
  session,
  initialRecordId,
  initialJobKey,
}: {
  session: Session;
  initialRecordId?: string;
  initialJobKey?: string;
}) {
  const [tab, setTab] = useState(
      initialRecordId ? "IPO Review" : "My Workspace",
    ),
    [data, setData] = useState<any>({ ipos: [], closures: [] }),
    [reports, setReports] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [job, setJob] = useState<any>(),
    [actual, setActual] = useState<Record<string, string>>({}),
    [epcAggregate, setEpcAggregate] = useState(""),
    [epcDetails, setEpcDetails] = useState(false),
    [epc, setEpc] = useState<Record<string, string>>({}),
    [remarks, setRemarks] = useState(""),
    [ack, setAck] = useState(""),
    [photos, setPhotos] = useState(""),
    [pt, setPt] = useState(""),
    [notes, setNotes] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorAction, setErrorAction] = useState(""),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState(""),
    [legacy, setLegacy] = useState(false);
  const input = {
    actual,
    epc,
    epcAggregate,
    epcDetails,
    remarks,
    ack,
    photos,
    pt,
  };
  const dirty = !!job && JSON.stringify(input) !== saved;
  useUnsavedChanges(dirty);
  const manager = ["Admin", "Management"].includes(session.user.role);
  const latest = job?.history[0];
  const readonly = ["Awaiting Management", "Closed"].includes(latest?.stage);
  async function load() {
    const [d, r] = await Promise.all([
      api<any>("/accounts-workspace"),
      api<any>("/inventory-reconciliation/reports"),
    ]);
    setData(d);
    setReports(r.reports.filter((x: any) => x.stage === "Sent to Accounts"));
  }
  useEffect(() => {
    void load()
      .then(() => {
        if (initialRecordId) void openIpo(initialRecordId);
        if (initialJobKey) void openJob(initialJobKey);
      })
      .catch((e) => setError(e.message));
  }, []);
  function navigate(t: string) {
    if (
      dirty &&
      !readonly &&
      !confirmTransition(
        "Leave closure entry",
        "Save a draft to retain your changes.",
      )
    )
      return;
    setTab(t);
    setJob(undefined);
    setSelected(undefined);
    setError("");
    setMessage("");
  }
  async function openIpo(id: string) {
    setBusy(true);
    try {
      setSelected(await api("/accounts-workspace/ipos/" + id));
      setTab("IPO Review");
      setNotes("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(decision: string) {
    setError("");
    setErrorAction("ipo");
    if (!selected || busy) return;
    if (!notes.trim()) {
      setError("Enter a review note or a clear revision reason.");
      return;
    }
    if (
      !confirmTransition(
        decision === "Verified" ? "Verify IPO" : "Return IPO for revision",
        "The approved selling amounts remain unchanged. Record this Accounts decision?",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/accounts-workspace/ipo-reviews", {
        csrf: session.csrfToken,
        body: {
          id: selected.ipo.id,
          version: selected.history[0]?.version ?? 0,
          decision,
          notes,
          requestKey: crypto.randomUUID(),
        },
      });
      await openIpo(selected.ipo.id);
      await load();
      setMessage("Accounts review recorded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openJob(key: string) {
    setBusy(true);
    try {
      const j = await api<any>(
        "/accounts-workspace/job?key=" + encodeURIComponent(key),
      );
      const i = j.history[0]?.snapshot.input;
      const v = {
        actual: i?.actual ?? {},
        epc: i?.epc ?? {},
        epcAggregate: i?.epcAggregate ?? j.history[0]?.snapshot.actualEpc ?? "",
        epcDetails:
          i?.epcDetails ??
          epcNames.every((n) => i?.epc?.[n] !== undefined && i.epc[n] !== ""),
        remarks: i?.remarks ?? "",
        ack: i?.acknowledgment ?? "",
        photos: i?.photos ?? "",
        pt: i?.ptReference ?? "",
      };
      setJob(j);
      setActual(v.actual);
      setEpc(v.epc);
      setEpcAggregate(v.epcAggregate);
      setEpcDetails(v.epcDetails);
      setRemarks(v.remarks);
      setAck(v.ack);
      setPhotos(v.photos);
      setPt(v.pt);
      setSaved(JSON.stringify(v));
      setTab("Job Closure");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(stage: string) {
    setError("");
    setErrorAction("closure");
    if (busy || !job) return;
    if (
      stage === "Awaiting Management" &&
      !confirmTransition(
        "Submit closure to Management",
        "Actual costs and evidence references will be frozen for review. The job closes only after Management approval.",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/accounts-workspace/closures", {
        csrf: session.csrfToken,
        body: {
          jobKey: job.jobKey,
          version: latest?.version ?? 0,
          stage,
          actual,
          epc: epcDetails ? epc : {},
          epcAggregate,
          epcDetails,
          remarks,
          acknowledgment: ack,
          photos,
          ptReference: pt,
          requestKey: crypto.randomUUID(),
        },
      });
      await openJob(job.jobKey);
      await load();
      setMessage(
        stage === "Draft"
          ? "Closure draft saved."
          : "Closure submitted to Management.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision: string) {
    setError("");
    setErrorAction("decision");
    if (!latest || !notes.trim()) {
      setError("Enter the Management decision note.");
      return;
    }
    if (
      !confirmTransition(
        decision === "Closed"
          ? "Approve job closure"
          : "Return closure for revision",
        decision === "Closed"
          ? "This records Management approval and closes this job."
          : "Accounts will be able to revise its actual-cost entry.",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/accounts-workspace/closure-decisions", {
        csrf: session.csrfToken,
        body: {
          id: latest.id,
          version: latest.version,
          decision,
          notes,
          requestKey: crypto.randomUUID(),
        },
      });
      await openJob(job.jobKey);
      await load();
      setMessage("Management decision recorded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = data.ipos.filter((i: any) =>
    `${i.number} ${i.snapshot.siteName} ${i.snapshot.customer?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const received = reports.filter(
    (r) => !data.closures.some((c: any) => c.job_key === r.job_key),
  );
  const total = (v: Record<string, string>, keys: string[]) =>
    keys.reduce((n, k) => n.add(v[k] || "0"), new Decimal(0));
  let actualTotal: Decimal | null = null,
    epcTotal = new Decimal(0);
  try {
    epcTotal = new Decimal(epcAggregate || "0");
    if (
      phases.every((k) => actual[k] !== undefined && actual[k] !== "") &&
      epcAggregate !== ""
    )
      actualTotal = total(actual, phases).add(epcTotal);
  } catch {}
  const budgetTotal = job
    ? Object.values(job.budget).reduce(
        (n: Decimal, v: any) => n.add(v),
        new Decimal(0),
      )
    : new Decimal(0);
  return (
    <section className="pz-accounts">
      <div className="pz-action-row">
        {[
          "My Workspace",
          "IPO Review",
          "Inventory Reconciliations",
          "Job Closure",
          "Invoicing",
        ].map((t) => (
          <Button
            key={t}
            variant={tab === t ? "secondary" : "neutral"}
            aria-pressed={tab === t}
            onClick={() => navigate(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <h2>{tab}</h2>
      {error && !errorAction && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {tab === "My Workspace" && (
        <>
          <div className="department-buckets">
            {[
              [
                "IPOs to review",
                data.ipos.filter(
                  (i: any) => i.accountsReview?.decision !== "Verified",
                ).length,
                "IPO Review",
              ],
              ["IRRs received", received.length, "Inventory Reconciliations"],
              [
                "Closure drafts / revisions",
                data.closures.filter((c: any) =>
                  ["Draft", "Returned for Revision"].includes(c.stage),
                ).length,
                "Job Closure",
              ],
              [
                "Waiting on Management",
                data.closures.filter(
                  (c: any) => c.stage === "Awaiting Management",
                ).length,
                "Job Closure",
              ],
            ].map(([label, count, destination]) => (
              <Button
                key={String(label)}
                onClick={() => navigate(String(destination))}
              >
                <span>{label}</span>
                <strong>{count}</strong>
              </Button>
            ))}
          </div>
          <h3>My Next Actions</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document / job</th>
                  <th>Stage</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.ipos
                  .filter((i: any) => i.accountsReview?.decision !== "Verified")
                  .map((i: any) => (
                    <tr key={i.id}>
                      <td>
                        {i.number}
                        <br />
                        {i.snapshot.siteName}
                      </td>
                      <td>{i.accountsReview?.decision ?? "IPO received"}</td>
                      <td>
                        <Button onClick={() => void openIpo(i.id)}>
                          Review IPO
                        </Button>
                      </td>
                    </tr>
                  ))}
                {received.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.job_id}
                      <br />
                      {r.site_name}
                    </td>
                    <td>Inventory reconciliation received</td>
                    <td>
                      <Button onClick={() => void openJob(r.job_key)}>
                        Prepare closure
                      </Button>
                    </td>
                  </tr>
                ))}
                {data.closures
                  .filter((c: any) => c.stage !== "Closed")
                  .map((c: any) => (
                    <tr key={c.id}>
                      <td>
                        {c.snapshot.jobId}
                        <br />
                        {c.snapshot.title}
                      </td>
                      <td>{c.stage}</td>
                      <td>
                        <Button onClick={() => void openJob(c.job_key)}>
                          {c.stage === "Awaiting Management"
                            ? "View submitted closure"
                            : "Continue closure"}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!data.ipos.length && !reports.length && (
            <p>No Accounts work has been received yet.</p>
          )}
        </>
      )}
      {tab === "IPO Review" && (
        <>
          <Field id="accounts-search" label="Search IPO or site">
            <input
              id="accounts-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>IPO / site</th>
                  <th>Accounts status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      {i.number}
                      <br />
                      {i.snapshot.siteName}
                    </td>
                    <td>{i.accountsReview?.decision ?? "Received"}</td>
                    <td>
                      <Button onClick={() => void openIpo(i.id)}>
                        Compare approved quote & IPO
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <article className="detail-panel">
              <h3>
                {selected.ipo.number} · {selected.saleType}
              </h3>
              <p>
                {selected.ipo.quotationType?.presentation ??
                  "Accepted quotation"}{" "}
                ·{" "}
                {selected.reconciles
                  ? "Totals reconcile with approved quotation"
                  : "Reconciliation needs attention"}
              </p>
              <div className="pz-form-grid">
                {selected.quotation?.id ? (
                  <DocumentPreview
                    title={"Approved quotation " + selected.quotation.number}
                    url={
                      "/api/commercial/quotations/" +
                      selected.quotation.id +
                      "/quotation.pdf"
                    }
                  />
                ) : (
                  <section>
                    <h3>Approved quotation</h3>
                    <p>Not available</p>
                  </section>
                )}
                <DocumentPreview
                  title={"IPO and PT " + selected.ipo.number}
                  url={"/api/orders/" + selected.ipo.id + "/ipo.pdf"}
                />
              </div>
              <details>
                <summary>Selling amount comparison</summary>
                <div className="pz-form-grid">
                  <section>
                    <h3>Approved quotation · {selected.quotation?.number}</h3>

                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quotationDisplayRows(
                            selected.quotation?.snapshot
                              .customerScopeVersion === 1
                              ? orderCustomerScopeLines(
                                  selected.quotation.snapshot.lines,
                                  selected.quotation.snapshot.presentation,
                                )
                              : (selected.quotation?.snapshot.lines ?? []),
                          ).map((l: any, i: number) => (
                            <tr key={i}>
                              <td>{l.description}</td>
                              {l.amount !== undefined ? (
                                <td className="pz-number" rowSpan={l.span ?? 1}>
                                  {money(l.amount)}
                                </td>
                              ) : selected.quotation.snapshot.presentation ===
                                "No Breakup" ? (
                                <td>Included in consolidated offer</td>
                              ) : null}
                            </tr>
                          ))}
                          {selected.quotation?.snapshot.footer?.map(
                            (l: any, i: number) => (
                              <tr key={"f" + i}>
                                <th>{l.label}</th>
                                <td className="pz-number">{money(l.amount)}</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                  <section>
                    <h3>IPO · Approved selling amounts</h3>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Amount including GST</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.ipo.snapshot.allocation.lines.map(
                            (l: any, i: number) => (
                              <tr key={i}>
                                <td>{l.description}</td>
                                <td className="pz-number">{money(l.total)}</td>
                              </tr>
                            ),
                          )}
                          <tr>
                            <th>Payable</th>
                            <td className="pz-number">
                              {money(selected.ipo.snapshot.allocation.total)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              </details>
              <h3>Discount allocation summary</h3>
              <p>
                Solar has zero discount. Allocation is preserved from the
                accepted quotation.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Original amount with GST</th>
                      <th>Allocated discount</th>
                      <th>Amount after discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.ipo.snapshot.allocation.lines.map(
                      (l: any, i: number) => (
                        <tr key={i}>
                          <td>{l.description}</td>
                          <td className="pz-number">
                            {money(l.originalTotal)}
                          </td>
                          <td className="pz-number">
                            {money(l.allocatedDiscount)}
                          </td>
                          <td className="pz-number">{money(l.total)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <td className="pz-number">
                        {money(
                          new Decimal(selected.ipo.snapshot.allocation.total)
                            .add(
                              selected.ipo.snapshot.allocation.originalDiscount,
                            )
                            .toString(),
                        )}
                      </td>
                      <td className="pz-number">
                        {money(
                          selected.ipo.snapshot.allocation.originalDiscount,
                        )}
                      </td>
                      <td className="pz-number">
                        {money(selected.ipo.snapshot.allocation.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <h3>PT selling breakup</h3>
              <div className="table-scroll">
                <table>
                  <tbody>
                    {selected.ipo.snapshot.peachtree?.phases
                      .filter((p: any) => p.name !== "EPC")
                      .map((p: any, i: number) => (
                        <tr key={i}>
                          <th>{p.name}</th>
                          <td className="pz-number">{money(p.amount)}</td>
                        </tr>
                      ))}
                    <tr>
                      <th>BESS total · inverter, batteries & BMS</th>
                      <td className="pz-number">
                        {money(
                          selected.ipo.snapshot.peachtree?.phases
                            .filter((p: any) =>
                              ["Inverter", "Batteries", "BMS", "BESS"].includes(
                                p.name,
                              ),
                            )
                            .reduce(
                              (n: Decimal, p: any) => n.add(p.amount),
                              new Decimal(0),
                            )
                            .toString(),
                        )}
                      </td>
                    </tr>
                    {selected.ipo.snapshot.peachtree?.phases
                      .filter((p: any) => p.name === "EPC")
                      .map((p: any) => (
                        <tr key={p.name}>
                          <th>{p.name}</th>
                          <td className="pz-number">{money(p.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {selected.history[0]?.decision !== "Verified" && (
                <>
                  <Field
                    id="accounts-note"
                    label="Review note / revision reason"
                  >
                    <textarea
                      id="accounts-note"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                  <div className="pz-action-row">
                    <Button
                      variant="success"
                      loading={busy}
                      disabled={!selected.reconciles}
                      onClick={() => void review("Verified")}
                    >
                      Verify IPO
                    </Button>
                    <Button
                      variant="warning"
                      disabled={busy}
                      onClick={() => void review("Returned for Revision")}
                    >
                      Return for revision
                    </Button>
                  </div>
                </>
              )}
              {error && errorAction === "ipo" && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <details>
                <summary>Accounts review history</summary>
                {selected.history.map((h: any) => (
                  <p key={h.id}>
                    {h.decision} · {h.recorded_by} · {h.notes}
                  </p>
                ))}
              </details>
            </article>
          )}
          <Button onClick={() => setLegacy(!legacy)}>
            Existing Accounts preparation records
          </Button>
          {legacy && <Departments session={session} department="Accounts" />}
        </>
      )}
      {tab === "Inventory Reconciliations" && (
        <InventoryWorkspace session={session} accounts />
      )}
      {tab === "Job Closure" && !job && (
        <>
          <h3>Jobs ready for Accounts costing</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job / site</th>
                  <th>Closure status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.job_id}
                      <br />
                      {r.site_name}
                    </td>
                    <td>
                      {data.closures.find((c: any) => c.job_key === r.job_key)
                        ?.stage ?? "IRR received"}
                    </td>
                    <td>
                      <Button onClick={() => void openJob(r.job_key)}>
                        Open job
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "Job Closure" && job && (
        <article className="detail-panel">
          <h3>
            {job.jobId} · {job.title}
          </h3>
          <p>
            {latest?.stage ?? "New closure"} · {job.basis}
            {latest && <> · Prepared by {latest.recorded_by}</>}
          </p>
          <p>
            Installation: {job.entry.start} → {job.entry.end} · Net days:{" "}
            {installationDays(job.entry) ?? "Not available"} (inclusive)
          </p>
          {manager && (
            <ClosureIndicators
              budget={budgetTotal.toString()}
              actual={actualTotal?.toString() ?? null}
              selling={job.selling}
              average={job.configurationComparison?.averageActualMarkupPercent}
              entry={job.entry}
            />
          )}
          <ClosureCostTables
            job={job}
            actual={actual}
            epc={epc}
            epcAggregate={epcAggregate}
            details={epcDetails}
            readonly={readonly}
            onActual={(name, value) => setActual({ ...actual, [name]: value })}
            onEpc={(name, value) => setEpc({ ...epc, [name]: value })}
            onAggregate={setEpcAggregate}
            onDetails={setEpcDetails}
          />
          <h3>Closure summary · excluding GST</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Budgeted</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Approved selling price</th>
                  <td className="pz-number">{money(job.selling)}</td>
                  <td className="pz-number">{money(job.selling)}</td>
                </tr>
                <tr>
                  <th>Total cost</th>
                  <td className="pz-number">{money(budgetTotal.toString())}</td>
                  <td className="pz-number">
                    {money(actualTotal?.toString())}
                  </td>
                </tr>
                <tr>
                  <th>Markup amount</th>
                  <td className="pz-number">
                    {money(
                      new Decimal(job.selling).sub(budgetTotal).toString(),
                    )}
                  </td>
                  <td className="pz-number">
                    {actualTotal
                      ? money(
                          new Decimal(job.selling).sub(actualTotal).toString(),
                        )
                      : "Not entered"}
                  </td>
                </tr>
                <tr>
                  <th>Markup % on cost</th>
                  <td className="pz-number">
                    {budgetTotal.isZero()
                      ? "Not available"
                      : money(
                          new Decimal(job.selling)
                            .sub(budgetTotal)
                            .div(budgetTotal)
                            .mul(100)
                            .toString(),
                        ) + "%"}
                  </td>
                  <td className="pz-number">
                    {!actualTotal || actualTotal.isZero()
                      ? "Not available"
                      : money(
                          new Decimal(job.selling)
                            .sub(actualTotal)
                            .div(actualTotal)
                            .mul(100)
                            .toString(),
                        ) + "%"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {actualTotal && (
            <section>
              <h3>Potential invoice adjustment impact · excluding GST</h3>
              <p>
                Scenario only, pending authorized invoice adjustment. This does
                not post an invoice or change the approved selling price.
              </p>
              <table>
                <tbody>
                  <tr>
                    <th>Reconciliation adjustment</th>
                    <td className="pz-number">
                      {money(job.reconciliation.net)}
                    </td>
                  </tr>
                  <tr>
                    <th>Selling price after potential adjustment</th>
                    <td className="pz-number">
                      {money(
                        new Decimal(job.selling)
                          .add(job.reconciliation.net)
                          .toString(),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Actual markup after potential adjustment</th>
                    <td className="pz-number">
                      {money(
                        new Decimal(job.selling)
                          .add(job.reconciliation.net)
                          .sub(actualTotal)
                          .toString(),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Actual markup % after potential adjustment</th>
                    <td className="pz-number">
                      {actualTotal.isZero()
                        ? "Not available"
                        : money(
                            new Decimal(job.selling)
                              .add(job.reconciliation.net)
                              .sub(actualTotal)
                              .div(actualTotal)
                              .mul(100)
                              .toString(),
                          ) + "%"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}
          <h3>Inventory reconciliation</h3>
          <p>
            Potential adjustment without GST: {money(job.reconciliation.net)} ·
            With GST: {money(job.reconciliation.gross)}
          </p>
          <p>
            This does not change approved selling values. Invoicing and
            authorized adjustment posting are deferred.
          </p>
          {readonly ? (
            <section className="detail-panel">
              <h3>Accounts remarks & supporting documents</h3>
              <p>{remarks || "No remarks provided."}</p>
              <details>
                <summary>
                  Client acknowledgment, site photos & PT references
                </summary>
                <p>
                  <strong>Client acknowledgment:</strong>{" "}
                  {ack || "Not available"}
                </p>
                <p>
                  <strong>Site photos:</strong> {photos || "Not available"}
                </p>
                <p>
                  <strong>PT supporting records:</strong>{" "}
                  {pt || "Not available"}
                </p>
              </details>
            </section>
          ) : (
            <>
              <div className="pz-form-grid">
                <Field id="closure-ack" label="Client acknowledgment reference">
                  <input
                    id="closure-ack"
                    disabled={readonly}
                    value={ack}
                    onChange={(e) => setAck(e.target.value)}
                  />
                </Field>
                <Field id="closure-photos" label="Site photographs reference">
                  <input
                    id="closure-photos"
                    disabled={readonly}
                    value={photos}
                    onChange={(e) => setPhotos(e.target.value)}
                  />
                </Field>
                <Field
                  id="closure-pt"
                  label="PT costing / supporting records reference"
                >
                  <input
                    id="closure-pt"
                    disabled={readonly}
                    value={pt}
                    onChange={(e) => setPt(e.target.value)}
                  />
                </Field>
                <Field
                  id="closure-remarks"
                  label="Accounts remarks / cost variance explanation"
                >
                  <textarea
                    id="closure-remarks"
                    disabled={readonly}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </Field>
              </div>
            </>
          )}
          {!readonly && (
            <div className="pz-action-row">
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => void save("Draft")}
              >
                Save closure draft
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void save("Awaiting Management")}
              >
                Submit closure to Management
              </Button>
            </div>
          )}
          {error && errorAction === "closure" && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {manager && latest?.stage === "Awaiting Management" && (
            <>
              <Field id="closure-decision" label="Management decision note">
                <textarea
                  id="closure-decision"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              <div className="pz-action-row">
                <Button
                  variant="success"
                  loading={busy}
                  onClick={() => void decide("Closed")}
                >
                  Approve and close job
                </Button>
                <Button
                  variant="warning"
                  disabled={busy}
                  onClick={() => void decide("Returned for Revision")}
                >
                  Return closure for revision
                </Button>
              </div>
            </>
          )}
          {error && errorAction === "decision" && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <details>
            <summary>Closure history</summary>
            {job.history.map((h: any) => (
              <p key={h.id}>
                V{h.version} · {h.stage} · {h.recorded_by} ·{" "}
                {new Date(h.created_at).toLocaleString("en-PK", {
                  timeZone: "Asia/Karachi",
                })}
              </p>
            ))}
          </details>
        </article>
      )}
      {tab === "Invoicing" && (
        <article className="detail-panel">
          <h3>Invoicing — Coming soon</h3>
          <p>
            Approved selling values and Inventory adjustments will feed the
            invoicing module after its workflow is agreed. No invoice is issued
            by this workspace.
          </p>
        </article>
      )}
    </section>
  );
}
