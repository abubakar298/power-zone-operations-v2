import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Session } from "../api.js";
import { confirmTransition } from "../confirm.js";
import { recommendSiteCode } from "../../server/boq/schema.js";
const quantities: Record<string, string> = {
  panelQty: "Panel quantity",
  panelWattage: "Panel wattage (W)",
  dcMetres: "6mm² DC cable total (m)",
  earth25: "2.5mm² earth cable (m)",
  earth6: "6mm² earth cable (m)",
  earth10: "10mm² earth cable (m)",
  batteryKwh: "Total battery capacity (kWh)",
};
export function Design({ session }: { session: Session }) {
  const [references, setReferences] = useState<any>(),
    [surveys, setSurveys] = useState<any[]>([]),
    [bucket, setBucket] = useState("Survey drafts"),
    [selected, setSelected] = useState<any>(),
    [editing, setEditing] = useState(false),
    [uploads, setUploads] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [formKey, setFormKey] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const locked =
    !!selected?.draft_id ||
    (!!selected && selected.owner_id !== session.user.id);
  async function load() {
    const d = await api<any>("/design");
    setSurveys(d.surveys);
  }
  useEffect(() => {
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
    };
    if (f.get("customerId")) v.customerId = Number(f.get("customerId"));
    for (const key of Object.keys(quantities)) {
      const value = String(f.get(key) ?? "");
      if (value !== "")
        v[key] = ["panelQty", "batteryKwh"].includes(key)
          ? Number(value)
          : value;
    }
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
        setBucket("Sent to Coordination");
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
  return (
    <section className="design-portal">
      <h2>Design workspace</h2>
      <p>
        Upload the completed site survey and enter the technical requirements
        for Coordination. Brand selection and costing are completed by the
        coordinator.
      </p>
      <div className="button-row">
        <button className="dark-button" onClick={() => open()} disabled={busy}>
          New design survey
        </button>
        <button
          disabled={busy}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh surveys
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="department-buckets">
        {["Survey drafts", "Sent to Coordination"].map((label) => (
          <button
            key={label}
            aria-pressed={bucket === label}
            onClick={() => setBucket(label)}
          >
            <span>{label}</span>
            <strong>
              {
                surveys.filter((s) =>
                  label === "Survey drafts" ? !s.draft_id : !!s.draft_id,
                ).length
              }
            </strong>
          </button>
        ))}
      </div>
      {!references && <p role="status">Loading survey workspace…</p>}
      <div className="table-scroll">
        <table className="master-table">
          <thead>
            <tr>
              <th>Customer / site</th>
              <th>Prepared by</th>
              <th>Updated / sent</th>
              <th>Coordinator</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {surveys
              .filter((s) =>
                bucket === "Survey drafts" ? !s.draft_id : !!s.draft_id,
              )
              .map((s) => (
                <tr key={s.id}>
                  <td>
                    {references?.customers.find(
                      (c: any) => c.id === s.inputs.customerId,
                    )?.name ?? "Customer not selected"}
                    <br />
                    {s.inputs.siteName || "Untitled survey"}
                  </td>
                  <td>{s.designer}</td>
                  <td>
                    {new Date(s.sent_at ?? s.updated_at).toLocaleString()}
                  </td>
                  <td>{s.assigned_name ?? "Not sent"}</td>
                  <td>
                    <button disabled={busy} onClick={() => open(s)}>
                      {s.draft_id ? "View survey" : "Open survey"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {references &&
        !surveys.some((s) =>
          bucket === "Survey drafts" ? !s.draft_id : !!s.draft_id,
        ) && <p>No surveys in this bucket.</p>}
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
                {Object.entries(quantities).map(([key, label]) => (
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
                      defaultValue={initial[key] ?? ""}
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
                <label>
                  Inverter configuration
                  <select
                    aria-label="Inverter configuration"
                    name="inverter"
                    required
                    defaultValue={initial.inverter ?? ""}
                  >
                    <option value="">Select configuration</option>
                    {references.inverters.map((v: any) => (
                      <option key={v.configuration}>{v.configuration}</option>
                    ))}
                  </select>
                </label>
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
