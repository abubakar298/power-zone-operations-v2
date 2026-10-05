import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";
import { recommendSiteCode } from "../../server/boq/schema.js";
import { extractText, surveySuggestions } from "../ocr.js";
import { BoqCosting } from "./BoqCosting.js";
const brandFields = {
  solar: "Solar Panel",
  inverter: "Inverter",
  battery: "Battery & BMS",
  cable: "Cable",
  switchgear: "Switchgear",
};
const quantities = {
  panelQty: "Panel quantity",
  panelWattage: "Panel wattage (W)",
  dcMetres: "6mm² DC cable total (m)",
  earth25: "2.5mm² earth cable (m)",
  earth6: "6mm² earth cable (m)",
  earth10: "10mm² earth cable (m)",
  batteryKwh: "Total battery capacity (kWh)",
};
export function Boqs({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const [masters, setMasters] = useState<any>(),
    [records, setRecords] = useState<any[]>([]),
    [drafts, setDrafts] = useState<any[]>([]),
    [view, setView] = useState<"list" | "new" | "saved">("list"),
    [draft, setDraft] = useState<{ id: string; version: number }>(),
    [initial, setInitial] = useState<any>({}),
    [uploads, setUploads] = useState<{ id: string; filename: string }[]>([]),
    [ocrText, setOcrText] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{ snapshot: any; fingerprint: string }>(),
    [saved, setSaved] = useState<any>(),
    [suggestions, setSuggestions] = useState<Record<string, string>>({}),
    [inverter, setInverter] = useState("10 kW");
  const form = useRef<HTMLFormElement>(null);
  async function load() {
    try {
      const [m, b, d] = await Promise.all([
        api("/masters"),
        api<{ boqs: any[] }>("/boqs"),
        api<{ drafts: any[] }>("/boqs/drafts"),
      ]);
      setMasters(m);
      setRecords(b.boqs);
      setDrafts(d.drafts);
    } catch (e) {
      fail(e);
    }
  }
  function fail(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onLogout();
    else
      setError(e instanceof Error ? e.message : "Unable to complete request.");
  }
  useEffect(() => {
    void load();
  }, []);
  function fresh() {
    setView("new");
    setInitial({});
    setDraft(undefined);
    setUploads([]);
    setOcrText("");
    setReviewed(false);
    setSuggestions({});
    setPreview(undefined);
    setSaved(undefined);
    setError("");
    setNotice("");
    setInverter("10 kW");
  }
  function resume(d: any) {
    setInitial(d.inputs);
    setDraft({ id: d.id, version: d.version });
    setUploads(
      d.inputs.uploadIds.map((id: string, i: number) => ({
        id,
        filename: `Source document ${i + 1}`,
      })),
    );
    setOcrText(d.inputs.ocrText ?? "");
    setReviewed(d.inputs.ocrReviewed ?? false);
    setPreview(undefined);
    setInverter(d.inputs.inverter ?? "10 kW");
    setView("new");
    setNotice("Draft loaded. Review and recalculate before saving.");
  }
  function read(validate = true) {
    if (!form.current || (validate && !form.current.reportValidity())) return;
    const f = new FormData(form.current);
    return {
      customerId: f.get("customerId") ? Number(f.get("customerId")) : undefined,
      siteName: f.get("siteName"),
      siteCode: f.get("siteCode"),
      location: f.get("location"),
      panelQty: f.get("panelQty") ? Number(f.get("panelQty")) : undefined,
      panelWattage: f.get("panelWattage"),
      structure: f.get("structure"),
      dcMetres: f.get("dcMetres"),
      earth25: f.get("earth25"),
      earth6: f.get("earth6"),
      earth10: f.get("earth10"),
      inverter: f.get("inverter"),
      batteryKwh: Number(f.get("batteryKwh")),
      smartMeter: f.get("smartMeter") === "yes",
      genset: f.get("genset") === "yes",
      brands: Object.fromEntries(
        Object.keys(brandFields)
          .filter((k) => f.get(`brand-${k}`))
          .map((k) => [k, Number(f.get(`brand-${k}`))]),
      ),
      preparedBy: f.get("preparedBy"),
      uploadIds: uploads.map((u) => u.id),
      ocrText,
      ocrReviewed: reviewed,
    };
  }
  async function persist(inputs = read(false)) {
    if (!inputs) return;
    const d = await api<{ id: string; version: number }>("/boqs/drafts", {
      body: { id: draft?.id, version: draft?.version ?? 0, inputs },
      csrf: session.csrfToken,
    });
    setDraft(d);
    await load();
    return d;
  }
  async function calculate(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const inputs = read();
    if (!inputs) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<{ snapshot: any; fingerprint: string }>(
        "/boqs/preview",
        { body: inputs, csrf: session.csrfToken },
      );
      await persist(inputs);
      setPreview(p);
      setNotice("Review the costing below. No BOQ number has been issued yet.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api("/boqs/save", {
        body: {
          draftId: draft.id,
          version: draft.version,
          fingerprint: preview.fingerprint,
        },
        csrf: session.csrfToken,
      });
      setSaved(r);
      setView("saved");
      setPreview(undefined);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    if (
      file.size > 8388608 ||
      !["image/png", "image/jpeg", "application/pdf", "text/plain"].includes(
        file.type,
      )
    ) {
      setError("Choose PNG, JPEG, PDF or text up to 8 MB.");
      return;
    }
    if (uploads.length >= 10) {
      setError("A survey supports up to ten source documents.");
      return;
    }
    setBusy(true);
    setError("");
    setPreview(undefined);
    setReviewed(false);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Unable to read file."));
        r.readAsDataURL(file);
      });
      const u = await api<{ id: string; filename: string }>("/survey-uploads", {
        body: {
          filename: file.name,
          mime: file.type,
          base64: dataUrl.split(",")[1],
        },
        csrf: session.csrfToken,
      });
      setUploads((old) => [...old, u]);
      setProgress("Extracting source text…");
      try {
        const result = await extractText(file, setProgress);
        const text = (ocrText + "\n" + result.text).trim().slice(0, 100000);
        setOcrText(text);
        setSuggestions(surveySuggestions(text));
        setNotice(
          "Source uploaded. Review the extracted text and confirm all survey fields.",
        );
      } catch (e) {
        setError(
          `${e instanceof Error ? e.message : "OCR failed."} The document was uploaded; you can enter survey values manually.`,
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  function applySuggestions() {
    if (!form.current) return;
    for (const [key, value] of Object.entries(suggestions)) {
      const input = form.current.elements.namedItem(key);
      if (input instanceof HTMLInputElement) input.value = value;
    }
    setPreview(undefined);
    setReviewed(false);
    setNotice(
      "Recognised values applied. Check every field against the source before saving.",
    );
  }
  if (!masters)
    return <p role="status">{error || "Loading project references…"}</p>;
  return (
    <section className="boq-section">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {view === "list" ? (
        <>
          <div className="panel-heading">
            <h2>BOQ workspace</h2>
            <button className="primary" onClick={fresh}>
              New BOQ
            </button>
          </div>
          <p>
            Create a new site from a survey, review the costing, then save an
            immutable R0.
          </p>
          <section className="detail-panel">
            <h3>Survey drafts</h3>
            {drafts.length === 0 ? (
              <p>No saved survey drafts.</p>
            ) : (
              drafts.map((d) => (
                <button
                  key={d.id}
                  className="draft-button"
                  onClick={() => resume(d)}
                >
                  {d.inputs.siteName || "Untitled survey"} ·{" "}
                  {new Date(d.updated_at).toLocaleString()}
                </button>
              ))
            )}
          </section>
          <section className="detail-panel">
            <h3>Saved BOQs</h3>
            {records.length === 0 ? (
              <p>No BOQs saved yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>BOQ</th>
                      <th>Customer / Site</th>
                      <th className="numeric">Budgeted cost (PKR)</th>
                      <th>Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button
                            onClick={() => {
                              setBusy(true);
                              void api(`/boqs/${r.id}`)
                                .then((v) => {
                                  setSaved(v);
                                  setView("saved");
                                })
                                .catch(fail)
                                .finally(() => setBusy(false));
                            }}
                            disabled={busy}
                          >
                            {r.number}
                          </button>
                        </td>
                        <td>
                          {r.customer}
                          <br />
                          {r.site}
                        </td>
                        <td className="numeric">
                          {Number(r.total).toLocaleString("en-PK", {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : view === "saved" ? (
        <>
          <button
            onClick={() => {
              setView("list");
              setNotice("");
            }}
          >
            Back to BOQs
          </button>
          <BoqCosting
            snapshot={saved.snapshot}
            number={saved.number}
            createdAt={saved.created_at}
          />
        </>
      ) : (
        <>
          <div className="panel-heading">
            <h2>New survey & BOQ</h2>
            <button onClick={() => setView("list")} disabled={busy}>
              Back to BOQs
            </button>
          </div>
          <p>
            A new BOQ creates a new site. No BOQ number is generated until you
            save the reviewed costing.
          </p>
          <section className="detail-panel upload-panel">
            <h3>Upload survey information</h3>
            <p>
              Use a survey image, screenshot, PDF (up to 5 pages) or text file.
              OCR runs on your device. Manual entry is always available.
            </p>
            <input
              aria-label="Upload survey document"
              type="file"
              accept="image/png,image/jpeg,application/pdf,text/plain"
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {progress && <p role="status">{progress}</p>}
            {uploads.map((u) => (
              <p key={u.id}>
                <a href={`/api/boqs/uploads/${u.id}`}>{u.filename}</a>{" "}
                <button
                  disabled={busy}
                  onClick={() => {
                    setUploads(uploads.filter((x) => x.id !== u.id));
                    setReviewed(false);
                    setPreview(undefined);
                  }}
                >
                  Remove from survey
                </button>
              </p>
            ))}
            {uploads.length > 0 && (
              <>
                <label className="source-label">
                  Extracted source text
                  <textarea
                    aria-label="Extracted source text"
                    value={ocrText}
                    maxLength={100000}
                    onChange={(e) => {
                      setOcrText(e.target.value);
                      setReviewed(false);
                      setPreview(undefined);
                      setSuggestions(surveySuggestions(e.target.value));
                    }}
                  />
                </label>
                {Object.keys(suggestions).length > 0 && (
                  <>
                    <p>
                      Recognised labelled fields:{" "}
                      {Object.entries(suggestions)
                        .map(
                          ([k, v]) =>
                            `${quantities[k as keyof typeof quantities]}: ${v}`,
                        )
                        .join(" · ")}
                    </p>
                    <button disabled={busy} onClick={applySuggestions}>
                      Apply recognised values for review
                    </button>
                  </>
                )}
                <label className="review-checkbox">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => {
                      setReviewed(e.target.checked);
                      setPreview(undefined);
                    }}
                  />
                  I checked the survey fields against the uploaded source
                  documents.
                </label>
              </>
            )}
          </section>
          <form
            ref={form}
            className="survey-form"
            onSubmit={calculate}
            onChange={() => {
              setPreview(undefined);
              setNotice("");
            }}
          >
            <fieldset disabled={busy}>
              <legend>1 · Customer & new site</legend>
              <div className="survey-grid">
                <label>
                  Customer
                  <select
                    name="customerId"
                    aria-label="Customer"
                    defaultValue={initial.customerId ?? ""}
                    required
                  >
                    <option value="">Select customer</option>
                    {masters.customers
                      .filter((c: any) => c.status === "Active")
                      .map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.short_code}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  New site name
                  <input
                    name="siteName"
                    aria-label="New site name"
                    defaultValue={initial.siteName ?? ""}
                    required
                    maxLength={200}
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
                    aria-label="Site code"
                    defaultValue={initial.siteCode ?? ""}
                    required
                    maxLength={30}
                    pattern="[A-Za-z0-9_-]+"
                  />
                  <small>
                    Suggested from the site name; you can edit it. Leading zeros
                    are preserved.
                  </small>
                </label>
                <label>
                  Location
                  <input
                    name="location"
                    aria-label="Location"
                    defaultValue={initial.location ?? ""}
                    maxLength={1000}
                  />
                </label>
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>2 · Survey quantities & solution</legend>
              <div className="survey-grid">
                {Object.entries(quantities).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input
                      name={k}
                      aria-label={label}
                      type="number"
                      required
                      min={
                        k === "panelQty" ? 1 : k === "panelWattage" ? 0.0001 : 0
                      }
                      max={
                        k === "batteryKwh"
                          ? inverter.startsWith("2×")
                            ? 120
                            : 60
                          : k === "panelQty"
                            ? 1000000
                            : 99999999
                      }
                      step={
                        k === "panelQty" ? 1 : k === "batteryKwh" ? 5 : 0.0001
                      }
                      defaultValue={
                        initial[k] ??
                        (k.startsWith("earth") ||
                        k === "dcMetres" ||
                        k === "batteryKwh"
                          ? "0"
                          : "")
                      }
                    />
                  </label>
                ))}
                <label>
                  Structure
                  <select
                    aria-label="Structure"
                    name="structure"
                    defaultValue={initial.structure ?? "L1"}
                  >
                    {["L1", "L2", "L3", "Elevated"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Inverter configuration
                  <select
                    aria-label="Inverter configuration"
                    name="inverter"
                    value={inverter}
                    onChange={(e) => setInverter(e.target.value)}
                  >
                    {masters.inverters.map((i: any) => (
                      <option key={i.configuration}>{i.configuration}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Extra smart meter
                  <select
                    name="smartMeter"
                    aria-label="Extra smart meter"
                    defaultValue={initial.smartMeter ? "yes" : "no"}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                <label>
                  Genset synchronisation
                  <select
                    name="genset"
                    aria-label="Genset synchronisation"
                    defaultValue={initial.genset ? "yes" : "no"}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>3 · Brands & preparation</legend>
              <div className="survey-grid">
                {Object.entries(brandFields).map(([k, category]) => (
                  <label key={k}>
                    {category} brand
                    <select
                      aria-label={`${category} brand`}
                      name={`brand-${k}`}
                      defaultValue={initial.brands?.[k] ?? ""}
                      required
                    >
                      <option value="">Select brand</option>
                      {masters.brands
                        .filter(
                          (b: any) =>
                            b.category === category && b.status === "Active",
                        )
                        .map((b: any) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <label>
                  Prepared by
                  <input
                    name="preparedBy"
                    aria-label="Prepared by"
                    defaultValue={
                      initial.preparedBy ?? session.user.displayName
                    }
                    maxLength={100}
                    required
                  />
                </label>
              </div>
            </fieldset>
            <div className="survey-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void persist()
                    .then((d) => {
                      if (d)
                        setNotice("Survey draft saved. No BOQ number issued.");
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                Save survey draft
              </button>
              <button className="primary" disabled={busy} type="submit">
                {busy ? "Processing…" : "Calculate & review BOQ"}
              </button>
            </div>
          </form>
          {preview && (
            <>
              <BoqCosting snapshot={preview.snapshot} />
              <div className="save-boq-panel">
                <p>
                  Save the reviewed survey as a new site and an immutable R0
                  BOQ.
                </p>
                <button
                  className="primary"
                  disabled={busy || (uploads.length > 0 && !reviewed)}
                  onClick={() => {
                    void save();
                  }}
                >
                  Save new BOQ
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
