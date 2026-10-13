import { DocumentPreview } from "../components/DocumentPreview.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { StatusBadge } from "../ui/StatusBadge.js";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
const stages = [
  "Survey Requests & Tracking",
  "Recommendations—Pending Submission",
  "Recommendations Submitted—Awaiting PO",
  "Heads-up Received—Preparation Pending",
  "Advance BOQ Sent—Awaiting PO",
  "PO Received—IPO Preparation",
  "IPO Submitted—Awaiting Accounts",
  "Accounts Accepted—BOQ Issuance Pending",
];
const configs = ["20-20-30", "25-20-30", "30-30-40", "35-30-40"];
export function UblWorkflow({
  session,
  initialRequestId,
  onBack,
}: {
  session: Session;
  initialRequestId?: string;
  onBack?: () => void;
}) {
  const [previewId, setPreviewId] = useState<string>();
  const [rows, setRows] = useState<any[]>([]),
    [sources, setSources] = useState<any[]>([]),
    [people, setPeople] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(),
    [detail, setDetail] = useState<any>(),
    [form, setForm] = useState<any>({}),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [error, setError] = useState(""),
    [actionError, setActionError] = useState<{
      action: string;
      message: string;
    }>(),
    [busy, setBusy] = useState(""),
    [success, setSuccess] = useState(""),
    [uploadKind, setUploadKind] = useState("Survey report");
  const role = session.user.role,
    manager = ["Admin", "Management"].includes(role),
    coord = manager || role === "Coordinator",
    design = manager || role === "Design",
    accounts = manager || role === "Accounts",
    ops = manager || role === "Operations";
  useUnsavedChanges(dirty);
  async function refresh() {
    const [v, s] = await Promise.all([
      api<any>("/ubl-workflow"),
      api<any>("/ubl-workflow/sources"),
    ]);
    setRows(v.requests);
    setPeople(v.people);
    setSources(s.sources);
  }
  useEffect(() => {
    void refresh()
      .then(() => {
        if (initialRequestId) return open({ id: initialRequestId });
      })
      .catch((e) => setError(e.message));
  }, []);
  async function open(r: any, checkDirty = true) {
    if (checkDirty && dirty && !window.confirm("Discard unsaved changes?"))
      return;
    setBusy("open");
    setActionError(undefined);
    try {
      const v = await api<any>(`/ubl-workflow/${r.id}`);
      setSelected(v.request);
      setDetail(v);
      setPreviewId(undefined);
      setForm({
        ...v.request.data,
        configuration: v.request.data.configuration ?? "",
        pricingStage: v.request.data.pricingStage ?? "Revised",
        notes: "",
        recipientId:
          v.request.data.recipientId ?? v.request.data.operationsOwnerId ?? "",
        poNumber: v.request.data.poNumber ?? "",
        ipoNumber: v.request.data.ipoNumber ?? "",
        date: "",
        verified: false,
      });
      setDirty(false);
    } catch (e) {
      setActionError({ action: "open", message: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  function change(k: string, v: any) {
    setForm((f: any) => ({ ...f, [k]: v }));
    setDirty(true);
  }
  async function action(a: string) {
    setBusy(a);
    setActionError(undefined);
    setSuccess("");
    try {
      let input: any = {};
      if (["save", "verify"].includes(a)) {
        for (const k of [
          "configuration",
          "pricingStage",
          "surveyStatus",
          "planningOwnerId",
          "technicalOwnerId",
          "operationsOwnerId",
          "scheduledSurveyDate",
          "actualSurveyDate",
        ])
          if (form[k] !== undefined) input[k] = form[k] || null;
        input.notes = form.notes;
        input.verified = form.verified;
      } else {
        for (const k of [
          "notes",
          "recipientId",
          "poNumber",
          "ipoNumber",
          "date",
          "branchCode",
        ])
          if (form[k]) input[k] = form[k];
        if (a === "po") {
          input.configuration = form.configuration;
          input.pricingStage = form.pricingStage;
        }
      }
      await api(`/ubl-workflow/${selected.id}/action`, {
        body: { version: selected.version, action: a, input },
        csrf: session.csrfToken,
      });
      setDirty(false);
      setSuccess("Saved. Workflow history updated.");
      await refresh();
      await open({ ...selected }, false);
    } catch (e) {
      setActionError({ action: a, message: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function importSource(s: any) {
    setBusy("import");
    setActionError(undefined);
    try {
      await api("/ubl-workflow/import", {
        body: { sha256: s.sha256, reviewed: true },
        csrf: session.csrfToken,
      });
      await refresh();
      setSuccess("Reviewed UBL source imported. Historical records preserved.");
    } catch (e) {
      setActionError({ action: "import", message: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    setActionError(undefined);
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Choose a file up to 8 MB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Unable to read this file."));
        reader.readAsDataURL(file);
      });
      await api(`/ubl-workflow/${selected.id}/attachments`, {
        body: {
          filename: file.name,
          mime: file.type,
          base64,
          kind: uploadKind,
        },
        csrf: session.csrfToken,
      });
      const v = await api<any>(`/ubl-workflow/${selected.id}`);
      setDetail(v);
      setSuccess("Attachment saved against this site.");
    } catch (e) {
      setActionError({ action: "upload", message: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  const departmentRows = rows.filter((r) =>
    role === "Accounts"
      ? r.stage === stages[6] ||
        r.stage === stages[7] ||
        r.data.accountsReviewSample
      : role === "Operations"
        ? [stages[3], stages[4], "Confirmed BOQ issued"].includes(r.stage)
        : true,
  );
  const matches = (r: any, f: string) =>
    f === "All" ||
    (f === "Review samples"
      ? r.data.accountsReviewSample
      : f === "Survey tracking"
        ? r.data.surveyStatus !== "Completed"
        : f === "Reports awaiting technical review"
          ? r.data.surveyStatus === "Completed" && !r.data.technicalVerified
          : f === "Verified recommendations"
            ? r.data.technicalVerified
            : r.stage === f);
  const filters =
    role === "Design"
      ? [
          "Survey tracking",
          "Reports awaiting technical review",
          "Verified recommendations",
        ]
      : role === "Accounts"
        ? [stages[6], stages[7], "Review samples"]
        : role === "Operations"
          ? [stages[3], stages[4], "Confirmed BOQ issued"]
          : [...stages, "Existing job—Revised PO pending"];
  const shown = departmentRows.filter(
    (r) =>
      matches(r, filter) &&
      `${r.site_name} ${r.branch_code ?? ""} ${r.data.ipoNumber ? "CHP-" + r.data.ipoNumber : ""} ${r.data.configuration ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function nextAction(r: any) {
    if (r.stage === "Existing job—Revised PO pending")
      return "Attach revised PO when received; no material planning needed";
    if (!r.branch_code) return "Confirm branch code and site identity";
    if (!r.data.configuration)
      return "Design: review configuration recommendation";
    const i = stages.indexOf(r.stage);
    return (
      [
        "Complete survey / enter verified recommendation",
        "Atif: send recommendation to UBL",
        "Await actual customer PO",
        "Atif: prepare advance BOQ",
        "Await actual PO; Operations preparation only",
        "Atif: prepare IPO / PT",
        "Accounts: accept or return IPO",
        "Atif: issue confirmed BOQ",
      ][i] ?? "See linked handoff history"
    );
  }
  const feedback = (a: string) =>
    actionError?.action === a ? (
      <p className="form-error" role="alert">
        {actionError.message}
      </p>
    ) : null;
  const act = (
    a: string,
    label: string,
    variant:
      "primary" | "secondary" | "neutral" | "warning" | "success" = "secondary",
  ) => (
    <div key={a}>
      <Button
        variant={variant}
        loading={busy === a}
        disabled={!!busy}
        onClick={() => void action(a)}
      >
        {label}
      </Button>
      {feedback(a)}
    </div>
  );
  const person = (key: string, label: string, department: string) => (
    <Field id={`ubl-${key}`} label={label}>
      <select
        id={`ubl-${key}`}
        value={form[key] ?? ""}
        onChange={(e) => change(key, e.target.value || null)}
      >
        <option value="">Unassigned</option>
        {people
          .filter((p) => p.role === department)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
      </select>
    </Field>
  );
  if (initialRequestId && !selected && !actionError)
    return <p role="status">Opening site record…</p>;
  return (
    <section className="pz-stack pz-ubl-workflow">
      <header>
        <h2>
          {initialRequestId
            ? "Pre-agreed configuration · Site record"
            : "UBL Site Workflow"}
        </h2>
        <p>
          Survey requests, configuration recommendations and PO handoffs.
          Reported history stays separate from verified actions.
        </p>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {success && <p role="status">{success}</p>}
      {initialRequestId && (
        <p className="pz-caption">
          Existing saved site workflow is retained. Automatic PO matching, IPO
          issuance and removal of the prior approval gate are pending backend
          integration.
        </p>
      )}
      {!initialRequestId &&
        sources.map((s) => (
          <div className="card" key={s.sha256}>
            <strong>{s.filename}</strong>
            <p>
              {s.site_count} sites ·{" "}
              {s.imported_batch
                ? "Imported with actor and timestamp"
                : "Reviewed source awaiting import"}
            </p>
            <div className="pz-action-row">
              <a href={`/api/ubl-workflow/sources/${s.sha256}/file`} download>
                Download original workbook
              </a>
              {manager && !s.imported_batch && (
                <Button
                  variant="primary"
                  loading={busy === "import"}
                  onClick={() => void importSource(s)}
                >
                  Import reviewed 36-site batch
                </Button>
              )}
            </div>
            {feedback("import")}
          </div>
        ))}
      {!selected ? (
        <>
          <div className="pz-action-row">
            <Button
              aria-pressed={filter === "All"}
              onClick={() => setFilter("All")}
            >
              All {departmentRows.length}
            </Button>
            {filters.map((s) => (
              <Button
                key={s}
                variant={filter === s ? "secondary" : "neutral"}
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                {s}{" "}
                <strong>
                  {departmentRows.filter((r) => matches(r, s)).length}
                </strong>
              </Button>
            ))}
            <Button onClick={() => setFilter("Deferred")}>Deferred</Button>
            <Button onClick={() => setFilter("Declined")}>Declined</Button>
            <Button onClick={() => setFilter("Confirmed BOQ issued")}>
              Handoff history
            </Button>
          </div>
          <Field
            id="ubl-workflow-search"
            label="Search site, branch, job ID or configuration"
          >
            <input
              id="ubl-workflow-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <p role="status">{shown.length} sites</p>
          <div className="pz-table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th>Site / branch</th>
                  <th>Survey / configuration</th>
                  <th>Workflow / next action</th>
                  <th>Responsibility</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <th>
                      {r.data.ipoNumber && <>CHP-{r.data.ipoNumber} · </>}UBL{" "}
                      {r.site_name}
                      <small>
                        Branch{" "}
                        {r.canonical_branch_code ??
                          r.branch_code ??
                          "Unconfirmed"}{" "}
                        · source row {r.source_row}
                      </small>
                    </th>
                    <td>
                      {r.data.surveyStatus}
                      <small>
                        {r.data.configuration ??
                          r.data.reportedRecommendation ??
                          "Recommendation pending"}
                      </small>
                      <StatusBadge
                        tone={r.data.technicalVerified ? "success" : "warning"}
                      >
                        {r.data.technicalVerified
                          ? "Verified"
                          : "Awaiting technical review"}
                      </StatusBadge>
                    </td>
                    <td>
                      {r.stage}
                      <small>
                        {r.branch_code === "2756"
                          ? "Installation reportedly nearing completion; revised PO pending"
                          : nextAction(r)}
                      </small>
                    </td>
                    <td>
                      {r.planning_owner ?? "Survey planning: Unassigned"}
                      <small>
                        {r.technical_owner ?? "Technical owner: Unassigned"}
                      </small>
                      <small>
                        {r.operations_owner ?? "Operations owner: Unassigned"}
                      </small>
                      <small>{r.data.operationsTeam}</small>
                    </td>
                    <td>
                      <Button
                        variant="secondary"
                        loading={busy === "open"}
                        onClick={() => void open(r)}
                      >
                        Open site
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!shown.length && <p>No sites in this view.</p>}
          {feedback("open")}
        </>
      ) : (
        <>
          <div className="pz-action-row">
            <Button
              onClick={() => {
                if (!dirty || window.confirm("Discard unsaved changes?")) {
                  if (onBack) {
                    onBack();
                    return;
                  }
                  setSelected(undefined);
                  setDetail(undefined);
                  setDirty(false);
                }
              }}
            >
              {initialRequestId
                ? "← Back to workspace"
                : "← Back to UBL workflow"}
            </Button>
            <StatusBadge>{selected.stage}</StatusBadge>
          </div>
          <h3>
            {selected.data.ipoNumber && `CHP-${selected.data.ipoNumber} · `}UBL{" "}
            {selected.site_name} (
            {selected.branch_code ?? "Branch code unconfirmed"}) ·{" "}
            {selected.data.configuration ?? "Configuration pending"}
          </h3>
          {manager && !selected.site_id && (
            <section className="card">
              <Field id="ubl-branch-identity" label="Confirmed branch code">
                <input
                  id="ubl-branch-identity"
                  value={form.branchCode ?? ""}
                  onChange={(e) => change("branchCode", e.target.value)}
                />
              </Field>
              {act("identity", "Confirm site identity", "primary")}
            </section>
          )}
          <section className="card">
            <h3>Source history & pending evidence</h3>
            <p>
              Site register row {selected.source_row}. Imported application
              actions use their actual recorded time.
            </p>
            <dl>
              {Object.entries(selected.source.dates ?? {})
                .filter(
                  ([k, v]) =>
                    v &&
                    k !== "Site Key" &&
                    k !== "Branch Code" &&
                    k !== "Branch Name" &&
                    k !== "_row",
                )
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
            </dl>
            {selected.data.originalOrderPreserved && (
              <p>
                Existing Sukho Road order retained. Installation reportedly
                nearing completion; revised PO pending.
              </p>
            )}
            <ul>
              {selected.data.flags?.map((f: string, i: number) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            <p>
              Missing source attachments:{" "}
              {selected.data.documentsPending?.join("; ")}
            </p>
            <details>
              <summary>Imported survey findings</summary>
              <dl>
                {Object.entries(selected.source.findings ?? {})
                  .filter(
                    ([k, v]) =>
                      v != null &&
                      ![
                        "_row",
                        "Site Key",
                        "Branch Code",
                        "Branch Name",
                      ].includes(k),
                  )
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          </section>
          {(coord || design) && (
            <section className="card">
              <h3>Survey & recommendation</h3>
              <div className="pz-form-grid">
                <Field id="ubl-survey-status" label="Survey stage">
                  <select
                    id="ubl-survey-status"
                    value={form.surveyStatus}
                    onChange={(e) => change("surveyStatus", e.target.value)}
                  >
                    {[
                      "Awaiting scheduling",
                      "Scheduled",
                      "In progress",
                      "Completed",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field id="ubl-config" label="Configuration recommendation">
                  <select
                    id="ubl-config"
                    value={form.configuration}
                    onChange={(e) => change("configuration", e.target.value)}
                  >
                    <option value="">Unconfirmed</option>
                    {configs.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field id="ubl-price-version" label="Agreed price version">
                  <select
                    id="ubl-price-version"
                    value={form.pricingStage}
                    onChange={(e) => change("pricingStage", e.target.value)}
                  >
                    {["Revised", "Negotiated", "Proposed"].map((s) => (
                      <option key={s} value={s}>
                        {s === "Revised" ? "Final revised" : s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="ubl-scheduled-survey" label="Scheduled survey date">
                  <input
                    id="ubl-scheduled-survey"
                    type="date"
                    value={form.scheduledSurveyDate ?? ""}
                    onChange={(e) =>
                      change("scheduledSurveyDate", e.target.value || null)
                    }
                  />
                </Field>
                <Field id="ubl-actual-survey" label="Actual survey date">
                  <input
                    id="ubl-actual-survey"
                    type="date"
                    value={form.actualSurveyDate ?? ""}
                    onChange={(e) =>
                      change("actualSurveyDate", e.target.value || null)
                    }
                  />
                </Field>
                {design &&
                  person("planningOwnerId", "Survey planning owner", "Design")}
                {design &&
                  person("technicalOwnerId", "Technical owner", "Design")}
                {person("operationsOwnerId", "Operations owner", "Operations")}
              </div>
              <label className="closure-details-toggle">
                <input
                  type="checkbox"
                  checked={form.verified}
                  onChange={(e) => change("verified", e.target.checked)}
                />
                Survey findings and the configuration have been reviewed
              </label>
              <div className="pz-action-row">
                {act("save", "Save working draft", "secondary")}
                {design && act("verify", "Verify recommendation", "primary")}
              </div>
            </section>
          )}
          <section className="card">
            <h3>Attachments</h3>
            <div className="pz-form-grid">
              <Field id="ubl-upload-kind" label="Evidence type">
                <select
                  id="ubl-upload-kind"
                  value={uploadKind}
                  onChange={(e) => setUploadKind(e.target.value)}
                >
                  {[
                    "Original request",
                    "Survey report",
                    "Sending evidence",
                    "Heads-up evidence",
                    "Customer PO",
                    "Operations evidence",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <Field
                id="ubl-file"
                label="Attach evidence"
                hint="PDF, PNG, JPEG or text · up to 8 MB"
              >
                <input
                  id="ubl-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.txt"
                  disabled={!!busy}
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
                {feedback("upload")}
              </Field>
            </div>
            <ul>
              {detail?.attachments.map((a: any) => (
                <li key={a.id}>
                  <a href={`/api/ubl-workflow/attachments/${a.id}`} download>
                    {a.kind} · {a.filename}
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h3>Next workflow action</h3>
            <div className="pz-form-grid">
              <Field id="ubl-notes" label="Action reference / remarks">
                <textarea
                  id="ubl-notes"
                  value={form.notes ?? ""}
                  onChange={(e) => change("notes", e.target.value)}
                />
              </Field>
              <Field id="ubl-date" label="Relevant historical / expected date">
                <input
                  id="ubl-date"
                  type="date"
                  value={form.date ?? ""}
                  onChange={(e) => change("date", e.target.value)}
                />
              </Field>
              {coord && (
                <>
                  <Field id="ubl-po" label="Actual customer PO number">
                    <input
                      id="ubl-po"
                      value={form.poNumber}
                      onChange={(e) => change("poNumber", e.target.value)}
                    />
                  </Field>
                  <Field
                    id="ubl-ipo"
                    label="Assigned IPO / CHP job number"
                    hint="Numeric portion only. Existing jobs retain their number."
                  >
                    <input
                      id="ubl-ipo"
                      value={form.ipoNumber}
                      onChange={(e) => change("ipoNumber", e.target.value)}
                    />
                  </Field>
                  {person(
                    "recipientId",
                    "Operations handoff recipient",
                    "Operations",
                  )}
                </>
              )}
            </div>
            <div className="pz-action-row">
              {["Admin", "Management"].includes(role) &&
                selected.stage === stages[3] &&
                selected.data.configuration &&
                act("sample", "Send review-only IPO / PT sample to Accounts")}
              {["Admin", "Management"].includes(role) &&
                selected.data.originalOrderPreserved &&
                selected.stage === stages[3] &&
                act(
                  "revision-pending",
                  "Move to existing job—revised PO pending",
                )}
              {coord &&
                selected.stage === stages[1] &&
                act("submit", "Record recommendation sent", "primary")}
              {coord &&
                selected.stage === stages[3] &&
                act("advance", "Send advance BOQ", "primary")}
              {coord &&
                [
                  ...stages.slice(1, 5),
                  "Deferred",
                  "Existing job—Revised PO pending",
                ].includes(selected.stage) &&
                act("po", "Record actual PO", "primary")}
              {coord &&
                selected.stage === stages[5] &&
                act("ipo", "Prepare IPO / PT & send to Accounts", "primary")}
              {accounts && selected.stage === stages[6] && (
                <>
                  {act("accept", "Accept IPO", "success")}
                  {act("return", "Return for revision", "warning")}
                </>
              )}
              {coord &&
                selected.stage === stages[7] &&
                act("confirmed", "Issue confirmed BOQ", "primary")}
              {ops &&
                [stages[4], "Confirmed BOQ issued"].includes(selected.stage) &&
                act("acknowledge", "Acknowledge BOQ & save preparation notes")}
              {coord && stages.slice(0, 5).includes(selected.stage) && (
                <>
                  {act("defer", "Record deferred")}
                  {act("decline", "Record declined", "warning")}
                </>
              )}
            </div>
            <p>
              Advance preparation does not authorize purchasing, stock issuance,
              dispatch or installation. Confirmed BOQ issuance requires Accounts
              acceptance.
            </p>
          </section>
          <section className="card">
            <h3>Linked documents</h3>
            {!detail?.documents.length && (
              <p>
                Source evidence is linked; verified working documents are
                generated as the workflow progresses.
              </p>
            )}
            <ul>
              {detail?.documents.map((d: any) => (
                <li key={d.id}>
                  <a href={`/api/ubl-workflow/documents/${d.id}.pdf`} download>
                    {d.kind} · version {d.version}
                  </a>{" "}
                  <Button
                    variant="neutral"
                    onClick={() =>
                      setPreviewId(previewId === d.id ? undefined : d.id)
                    }
                  >
                    Preview
                  </Button>
                </li>
              ))}
            </ul>
            {previewId && (
              <DocumentPreview
                title="UBL saved document"
                url={`/api/ubl-workflow/documents/${previewId}.pdf`}
              />
            )}
          </section>
          <section className="card">
            <h3>Application history</h3>
            <ul>
              {detail?.events.map((e: any) => (
                <li key={e.id}>
                  {e.action} · {e.actor} ·{" "}
                  {new Date(e.created_at).toLocaleString("en-GB", {
                    timeZone: "Asia/Karachi",
                  })}{" "}
                  · V{e.version}
                  {e.snapshot.notes && <small>{e.snapshot.notes}</small>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
