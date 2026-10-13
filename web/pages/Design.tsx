import { DepartmentWorkspace } from "./DepartmentWorkspace.js";
import { Button } from "../ui/Button.js";
import { UblWorkflow } from "./UblWorkflow.js";
import {
  WorkspaceFilters,
  emptyWorkspaceFilters,
  matchesWorkspace,
} from "../components/WorkspaceFilters.js";
import {
  designBuckets,
  designBucket,
  frameworkTask,
  routes,
  taskAge,
} from "../workspaces/tasks.js";
import { BessSelector } from "../components/BessSelector.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Session } from "../api.js";
import { confirmTransition } from "../confirm.js";
import { recommendSiteCode } from "../../server/boq/schema.js";
const quantities: Record<string, string> = {
  panelQty: "Panel quantity",
  panelWattage: "Panel wattage (W)",
  dcMetres: "6mm² DC cable total (m)",
  acInverter16: "Inverter termination · 16 mm² 4-core (m)",
  acInverter25: "Inverter termination · 25 mm² 4-core (m)",
  acPanel16: "Panel termination · 16 mm² 4-core (m)",
  acPanel25: "Panel termination · 25 mm² 4-core (m)",

  earth25: "2.5mm² earth cable (m)",
  earth6: "6mm² earth cable (m)",
  earth10: "10mm² earth cable (m)",
  batteryKwh: "Total battery capacity (kWh)",
};
export function LegacyDesign({ session }: { session: Session }) {
  const [references, setReferences] = useState<any>(),
    [surveys, setSurveys] = useState<any[]>([]),
    [bucket, setBucket] = useState(designBuckets[2]),
    [selected, setSelected] = useState<any>(),
    [editing, setEditing] = useState(false),
    [uploads, setUploads] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [formKey, setFormKey] = useState(0);
  const [framework, setFramework] = useState<any[]>([]),
    [frameworkId, setFrameworkId] = useState<string>(),
    [filters, setFilters] = useState({ ...emptyWorkspaceFilters }),
    [taskScope, setTaskScope] = useState(
      session.user.role === "Design" ? "mine" : "team",
    ),
    [frameworkError, setFrameworkError] = useState("");
  async function loadFramework() {
    try {
      const r = await api<any>("/ubl-workflow");
      setFramework(r.requests);
      setFrameworkError("");
    } catch (e) {
      setFrameworkError((e as Error).message);
    }
  }
  const form = useRef<HTMLFormElement>(null);
  const locked =
    !!selected?.draft_id ||
    (!!selected && selected.owner_id !== session.user.id);
  async function load() {
    const d = await api<any>("/design");
    setSurveys(d.surveys);
    await loadFramework();
  }
  useEffect(() => {
    void loadFramework();
    void Promise.all([api("/design/references"), api<any>("/design")])
      .then(([r, d]) => {
        setReferences(r);
        setSurveys(d.surveys);
      })
      .catch((e) => setError(e.message));
  }, []);
  function open(row?: any) {
    setSelected(row);
    setUploads(row?.attachments ?? []);
    setEditing(true);
    setNotice("");
    setError("");
    setFormKey((k) => k + 1);
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      if (
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type) ||
        file.size > 8388608
      )
        throw new Error("Use a PDF, PNG or JPEG up to 8 MB.");
      if (uploads.length >= 10)
        throw new Error("Attach up to 10 survey files.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Unable to read the file."));
        reader.readAsDataURL(file);
      });
      const u = await api<any>("/survey-uploads", {
        body: { filename: file.name, mime: file.type, base64 },
        csrf: session.csrfToken,
      });
      setUploads((old) => [...old, u]);
      setNotice("Survey form uploaded. Save the draft to keep it attached.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function inputs() {
    const f = new FormData(form.current!);
    const v: any = {
      siteName: String(f.get("siteName") ?? ""),
      siteCode: String(f.get("siteCode") ?? ""),
      location: String(f.get("location") ?? ""),
      uploadIds: uploads.map((u) => u.id),
      notes: String(f.get("notes") ?? ""),
      workflowStage: String(f.get("workflowStage") ?? designBuckets[2]),
      workflowRoute: String(f.get("workflowRoute") ?? routes[0]),
      surveyStatus: String(f.get("surveyStatus") ?? "Completed"),
      scheduledSurveyDate:
        String(f.get("scheduledSurveyDate") ?? "") || undefined,
      responsiblePerson: String(f.get("responsiblePerson") ?? ""),
      region: String(f.get("region") ?? ""),
      revisionReason: String(f.get("revisionReason") ?? ""),
    };
    if (f.get("customerId")) v.customerId = Number(f.get("customerId"));
    for (const key of Object.keys(quantities)) {
      const value = String(f.get(key) ?? "");
      if (value !== "")
        v[key] = ["panelQty", "batteryKwh"].includes(key)
          ? Number(value)
          : value;
    }
    if (f.get("bessId")) v.bessId = f.get("bessId");
    if (String(f.get("batteryKwh") ?? ""))
      v.batteryKwh = Number(f.get("batteryKwh"));
    for (const key of ["structure", "inverter"])
      if (f.get(key)) v[key] = f.get(key);
    for (const key of ["smartMeter", "genset"])
      if (f.get(key)) v[key] = f.get(key) === "yes";
    return v;
  }
  async function save(send: boolean) {
    if (busy || locked) return;
    if (send && !form.current!.reportValidity()) return;
    const f = new FormData(form.current!);
    if (send && !f.get("verified")) {
      setError("Confirm the entered details match the physical survey.");
      return;
    }
    if (send && !uploads.length) {
      setError("Attach the completed physical survey form.");
      return;
    }
    if (
      send &&
      !confirmTransition(
        "Send survey to Coordination",
        "The technical survey and its attachments will be frozen and a BOQ draft will appear in the selected coordinator’s Survey preparation bucket. Brands will be selected by the coordinator.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const row = await api<any>("/design", {
        body: {
          id: selected?.id,
          version: selected?.version ?? 0,
          inputs: inputs(),
        },
        csrf: session.csrfToken,
      });
      setSelected({ ...row, attachments: uploads });
      if (send) {
        const sent = await api<any>(`/design/${row.id}/send`, {
          body: {
            version: row.version,
            coordinatorId: f.get("coordinatorId"),
            verified: true,
          },
          csrf: session.csrfToken,
        });
        setSelected({
          ...row,
          ...sent,
          id: row.id,
          attachments: uploads,
          draft_id: sent.draft_id,
          assigned_name: references.coordinators.find(
            (u: any) => u.id === sent.assigned_to,
          )?.display_name,
          sent_at: sent.created_at,
        });
        setBucket(designBuckets[3]);
        setNotice(
          "Survey sent. The coordinator can select brands and prepare costing.",
        );
      } else setNotice("Survey draft saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const initial = selected?.inputs ?? {};
  const manager = ["Admin", "Management"].includes(session.user.role);
  const tasks = [
    ...surveys.map((s) => ({
      ...s,
      customer:
        references?.customers.find((c: any) => c.id === s.inputs.customerId)
          ?.name ?? "Customer not selected",
      site: s.inputs.siteName || "Untitled survey",
      reference: s.number,
      person: s.inputs.responsiblePerson || s.designer,
      region: s.inputs.region || "Not entered",
      route: s.inputs.workflowRoute ?? routes[0],
      started_at: s.sent_at ?? s.updated_at,
      taskBucket: designBucket(s),
      overdue:
        !!s.inputs.scheduledSurveyDate &&
        new Date(s.inputs.scheduledSurveyDate).getTime() < Date.now() &&
        ["Scheduled", "In progress"].includes(s.inputs.surveyStatus),
    })),
    ...framework
      .filter(
        (r) =>
          !r.data?.technicalVerified ||
          r.data?.returnReason ||
          r.stage.includes("Recommendation"),
      )
      .map((r) => ({
        ...frameworkTask(r),
        taskBucket:
          r.stage.includes("Recommendations Submitted") && !r.data?.returnReason
            ? designBuckets[3]
            : designBucket(r),
        overdue:
          !!r.data?.scheduledSurveyDate &&
          new Date(r.data.scheduledSurveyDate).getTime() < Date.now() &&
          ["Scheduled", "In progress"].includes(r.data?.surveyStatus),
      })),
  ];
  const scoped = tasks.filter(
    (t) =>
      taskScope === "team" ||
      (t.framework
        ? [
            t.framework.data?.planningOwnerId,
            t.framework.data?.technicalOwnerId,
          ].includes(session.user.id)
        : t.owner_id === session.user.id),
  );
  const filtered = scoped.filter((t) => matchesWorkspace(t, filters));
  const shown = filtered.filter((t) => t.taskBucket === bucket);
  if (frameworkId)
    return (
      <UblWorkflow
        session={session}
        initialRequestId={frameworkId}
        onBack={() => {
          setFrameworkId(undefined);
          void loadFramework();
        }}
      />
    );
  return (
    <section className="design-portal pz-stack">
      <header>
        <h2>Design workspace</h2>
        <p>
          Schedule surveys, review original evidence and prepare verified
          handoffs to Coordination.
        </p>
      </header>
      <div className="pz-action-row">
        <Button variant="primary" onClick={() => open()} disabled={busy}>
          New design survey
        </Button>
        <Button
          variant="neutral"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh workspace
        </Button>
        {manager && (
          <>
            <Button
              variant="neutral"
              aria-pressed={taskScope === "mine"}
              onClick={() => setTaskScope("mine")}
            >
              My Tasks
            </Button>
            <Button
              variant="neutral"
              aria-pressed={taskScope === "team"}
              onClick={() => setTaskScope("team")}
            >
              Team Tasks
            </Button>
          </>
        )}
      </div>
      {error && !editing && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {frameworkError && (
        <p role="alert" className="form-error">
          Pre-agreed survey records could not load: {frameworkError}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="summary-grid">
        <article className="summary-card">
          <span>Still in process</span>
          <strong>
            {filtered.filter((t) => t.taskBucket !== designBuckets[3]).length}
          </strong>
        </article>
        <article className="summary-card">
          <span>Handed off</span>
          <strong>
            {filtered.filter((t) => t.taskBucket === designBuckets[3]).length}
          </strong>
          <small>Existing recorded handoffs; date filters apply</small>
        </article>
      </div>
      <WorkspaceFilters rows={scoped} value={filters} onChange={setFilters} compact searchLabel="Search survey requests" showTaskModes={false} />
      <div className="department-buckets">
        {designBuckets.map((label) => (
          <Button
            key={label}
            variant="neutral"
            aria-pressed={bucket === label}
            onClick={() => setBucket(label)}
          >
            <span>{label}</span>
            <strong>
              {filtered.filter((t) => t.taskBucket === label).length}
            </strong>
          </Button>
        ))}
      </div>
      {!references && <p role="status">Loading survey workspace…</p>}
      <div className="pz-table-scroll">
        <table className="master-table">
          <thead>
            <tr>
              <th>Customer / site / route</th>
              <th>Responsible / age</th>
              <th>Next action / blocker</th>
              <th>Documents / record</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={`${t.framework ? "framework" : "survey"}-${t.id}`}>
                <td>
                  <strong>{t.customer}</strong>
                  <br />
                  {t.site}
                  <small>
                    {t.reference} · {t.route}
                  </small>
                </td>
                <td>
                  {t.person}
                  <small>
                    {taskAge(t.started_at)} ·{" "}
                    {t.assigned_name
                      ? `Sent to ${t.assigned_name}`
                      : "Handoff pending"}
                  </small>
                </td>
                <td>
                  {t.taskBucket === designBuckets[3]
                    ? "View submitted evidence and history"
                    : t.taskBucket === designBuckets[0]
                      ? "Sajid: schedule survey"
                      : t.taskBucket === designBuckets[1]
                        ? "Complete visit and upload report"
                        : t.taskBucket === designBuckets[2]
                          ? "Solution Engineer: verify technical details"
                          : "Review requirements and prepare handoff"}
                  <small>
                    {t.inputs?.revisionReason || t.framework?.data?.returnReason
                      ? `Revision required: ${t.inputs?.revisionReason || t.framework?.data?.returnReason}`
                      : t.blocker || "No blocker recorded"}
                  </small>
                </td>
                <td>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      t.framework ? setFrameworkId(t.id) : open(t)
                    }
                  >
                    Open record & documents
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {references && !shown.length && (
        <p>No records match this bucket and filters.</p>
      )}
      <p className="pz-caption">
        General technical returns from Coordination and rule/brand selection in
        the Design form are pending integration. Existing pre-agreed
        recommendation review is available through its site record.
      </p>
      <p className="pz-caption">
        Ordinary-item costing remains available through authorised costing
        records. Restricted equipment costs and totals are not loaded in this
        workspace. Customer-specific recommendation records use their existing
        verified workflow.
      </p>
      {editing && references && (
        <article className="detail-panel">
          <h3>
            {selected?.draft_id
              ? "Sent survey · Read only"
              : selected
                ? "Design survey draft"
                : "New design survey"}
          </h3>
          {selected?.draft_id && (
            <p>
              Sent to {selected.assigned_name} ·{" "}
              {new Date(selected.sent_at).toLocaleString()}. The submitted
              survey remains unchanged while Coordination prepares its BOQ.
            </p>
          )}
          <form
            key={formKey}
            ref={form}
            className="survey-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void save(true);
            }}
          >
            <fieldset disabled={busy || locked}>
              <legend>1 · Customer and site</legend>
              <div className="survey-grid">
                <label>
                  Workflow route
                  <select
                    name="workflowRoute"
                    defaultValue={initial.workflowRoute ?? routes[0]}
                  >
                    <option>{routes[0]}</option>
                  </select>
                </label>
                <label>
                  Design stage
                  <select
                    name="workflowStage"
                    defaultValue={initial.workflowStage ?? designBuckets[2]}
                  >
                    {designBuckets.slice(0, 3).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Survey visit status
                  <select
                    name="surveyStatus"
                    defaultValue={initial.surveyStatus ?? "Completed"}
                  >
                    {[
                      "Awaiting scheduling",
                      "Scheduled",
                      "In progress",
                      "Completed",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Planned survey date
                  <input
                    name="scheduledSurveyDate"
                    type="date"
                    defaultValue={initial.scheduledSurveyDate ?? ""}
                  />
                </label>
                <label>
                  Region
                  <input
                    name="region"
                    maxLength={100}
                    defaultValue={initial.region ?? ""}
                  />
                </label>
                <label>
                  Responsible person
                  <input
                    name="responsiblePerson"
                    maxLength={200}
                    defaultValue={
                      initial.responsiblePerson ?? session.user.displayName
                    }
                  />
                </label>
                <label>
                  Revision reason / blocker
                  <textarea
                    name="revisionReason"
                    maxLength={2000}
                    defaultValue={initial.revisionReason ?? ""}
                  />
                </label>
              </div>
              <div className="survey-grid">
                <label>
                  Customer
                  <select
                    aria-label="Customer"
                    name="customerId"
                    required
                    defaultValue={initial.customerId ?? ""}
                  >
                    <option value="">Select customer</option>
                    {references.customers.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.short_code}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Site name
                  <input
                    name="siteName"
                    required
                    maxLength={200}
                    defaultValue={initial.siteName ?? ""}
                    onBlur={(e) => {
                      const code = form.current?.elements.namedItem("siteCode");
                      if (code instanceof HTMLInputElement && !code.value)
                        code.value = recommendSiteCode(e.target.value);
                    }}
                  />
                </label>
                <label>
                  Site code
                  <input
                    name="siteCode"
                    required
                    pattern="[A-Za-z0-9_-]+"
                    maxLength={30}
                    defaultValue={initial.siteCode ?? ""}
                  />
                </label>
                <label>
                  Location
                  <input
                    name="location"
                    maxLength={1000}
                    defaultValue={initial.location ?? ""}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset disabled={busy || locked}>
              <legend>2 · Technical requirements</legend>
              <div className="survey-grid">
                {Object.entries(quantities)
                  .filter(([key]) => key !== "batteryKwh")
                  .map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        aria-label={label}
                        name={key}
                        required
                        min={
                          key === "panelQty"
                            ? 1
                            : key === "panelWattage"
                              ? 0.0001
                              : 0
                        }
                        max={
                          key === "batteryKwh"
                            ? 120
                            : key === "panelQty"
                              ? 1000000
                              : 99999999
                        }
                        step={
                          ["panelQty", "batteryKwh"].includes(key) ? 1 : 0.0001
                        }
                        defaultValue={
                          initial[key] ?? (key.startsWith("ac") ? "0" : "")
                        }
                      />
                    </label>
                  ))}
                <label>
                  Structure
                  <select
                    aria-label="Structure"
                    name="structure"
                    required
                    defaultValue={initial.structure ?? ""}
                  >
                    <option value="">Select structure</option>
                    {["L1", "L2", "L3", "Elevated"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <BessSelector initial={initial} />
                {["smartMeter", "genset"].map((key) => (
                  <label key={key}>
                    {key === "smartMeter"
                      ? "Extra smart meter"
                      : "Genset synchronisation"}
                    <select
                      aria-label={
                        key === "smartMeter"
                          ? "Extra smart meter"
                          : "Genset synchronisation"
                      }
                      name={key}
                      required
                      defaultValue={
                        initial[key] === undefined
                          ? ""
                          : initial[key]
                            ? "yes"
                            : "no"
                      }
                    >
                      <option value="">Select requirement</option>
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>
                ))}
              </div>
              <p className="field-hint">
                Enter measured DC cable length as the combined red and black
                total. AC cable allowances follow the existing inverter
                configuration rules. No brands or prices are required here.
              </p>
            </fieldset>
            <fieldset disabled={busy || locked}>
              <legend>3 · Physical survey and notes</legend>
              <label>
                Completed survey form (PDF, PNG or JPEG; up to 8 MB each)
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              <ul>
                {uploads.map((u) => (
                  <li key={u.id}>
                    <a href={`/api/design/uploads/${u.id}`}>{u.filename}</a>
                    {!locked && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setUploads((old) => old.filter((a) => a.id !== u.id))
                        }
                      >
                        Remove {u.filename}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <label>
                Technical notes
                <textarea
                  aria-label="Technical notes"
                  name="notes"
                  maxLength={2000}
                  defaultValue={initial.notes ?? ""}
                />
              </label>
            </fieldset>
            {!locked && (
              <fieldset disabled={busy}>
                <legend>4 · Send to Coordination</legend>
                <label>
                  Coordinator
                  <select
                    aria-label="Coordinator"
                    name="coordinatorId"
                    required
                    defaultValue={
                      references.coordinators.length === 1
                        ? references.coordinators[0].id
                        : ""
                    }
                  >
                    <option value="">Select coordinator</option>
                    {references.coordinators.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                {!references.coordinators.length && (
                  <p>
                    An administrator must create an active Coordinator account
                    before a survey can be sent.
                  </p>
                )}
                <label>
                  <input
                    type="checkbox"
                    name="verified"
                    style={{ width: "auto", display: "inline-block" }}
                  />{" "}
                  I checked these technical details against the physical survey
                  form.
                </label>
                <div className="button-row">
                  {error && (
                    <p role="alert" className="form-error">
                      {error}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(false)}
                  >
                    Save survey draft
                  </button>
                  <button
                    className="dark-button"
                    type="submit"
                    disabled={busy || !references.coordinators.length}
                  >
                    Save and send to Coordination
                  </button>
                </div>
              </fieldset>
            )}
          </form>
        </article>
      )}
    </section>
  );
}

export function Design({ session }: { session: Session }) {
  return <DepartmentWorkspace session={session} department="design" />;
}
