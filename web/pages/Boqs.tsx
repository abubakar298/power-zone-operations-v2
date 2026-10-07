import { money } from "../numbers.js";
import { BessSelector } from "../components/BessSelector.js";
import { CostingWorkflowHistory } from "../components/CostingWorkflowHistory.js";
import { confirmTransition } from "../confirm.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";
import { recommendSiteCode } from "../../server/boq/schema.js";
import { generalAllowances } from "../../server/boq/general.js";
import { extractText, surveySuggestions } from "../ocr.js";
import {
  ApprovalInstructions,
  blankInstructions,
} from "../components/ApprovalInstructions.js";
import { BoqCosting } from "./BoqCosting.js";
import { NewCustomer } from "../components/NewCustomer.js";
import { canWriteMaster } from "../../server/masters/permissions.js";
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
  acInverter16: "Inverter termination · 16 mm² 4-core (m)",
  acInverter25: "Inverter termination · 25 mm² 4-core (m)",
  acPanel16: "Panel termination · 16 mm² 4-core (m)",
  acPanel25: "Panel termination · 25 mm² 4-core (m)",

  earth25: "2.5mm² earth cable (m)",
  earth6: "6mm² earth cable (m)",
  earth10: "10mm² earth cable (m)",
  batteryKwh: "Total battery capacity (kWh)",
};
export function Boqs({
  session,
  onLogout,
  onPricing,
  initialDraftId,
}: {
  session: Session;
  onLogout: () => void;
  onPricing?: (id: string) => void;
  initialDraftId?: string;
}) {
  const [masters, setMasters] = useState<any>(),
    [records, setRecords] = useState<any[]>([]),
    [drafts, setDrafts] = useState<any[]>([]),
    [view, setView] = useState<"list" | "new" | "saved" | "review">("list"),
    [reviewRows, setReviewRows] = useState<any[]>([]),
    [currentReview, setCurrentReview] = useState<any>(),
    [reviewComments, setReviewComments] = useState(""),
    [instructions, setInstructions] = useState(blankInstructions),
    [changeQuotationSettings, setChangeQuotationSettings] = useState(false),
    [approvalEvidence, setApprovalEvidence] = useState<
      { id: string; filename: string }[]
    >([]),
    [externalApprover, setExternalApprover] = useState(""),
    [externalConfirmed, setExternalConfirmed] = useState(false),
    [baseRevisionId, setBaseRevisionId] = useState<string>(),
    [revisionReason, setRevisionReason] = useState(""),
    [revisionOrigin, setRevisionOrigin] = useState("Internal management"),
    [additionalItem, setAdditionalItem] = useState<any>(),
    [specifications, setSpecifications] = useState<Record<string, string>>({}),
    [technicalLines, setTechnicalLines] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
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
    [designSource, setDesignSource] = useState<any>(),
    [sourceMode, setSourceMode] = useState("Survey"),
    [pvInput, setPvInput] = useState({ qty: 0, wattage: "0" }),
    [inverter, setInverter] = useState("10 kW");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string>();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!createdCustomerId || !masters) return;
    const select = form.current?.elements.namedItem("customerId");
    if (select instanceof HTMLSelectElement) {
      select.value = createdCustomerId;
      setPreview(undefined);
      setCreatedCustomerId(undefined);
    }
  }, [masters, createdCustomerId]);
  async function load() {
    try {
      const [m, b, d, r] = await Promise.all([
        api("/masters"),
        api<{ boqs: any[] }>("/boqs"),
        api<{ drafts: any[] }>("/boqs/drafts"),
        api<{ reviews: any[] }>("/boqs/reviews"),
      ]);
      setMasters(m);
      setRecords(b.boqs);
      setDrafts(d.drafts);
      setReviewRows(r.reviews);
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
    void load()
      .then(async () => {
        if (initialDraftId) {
          const d = await api<{ drafts: any[] }>("/boqs/drafts");
          const row = d.drafts.find((x) => x.id === initialDraftId);
          if (row && row.review_status !== "Awaiting review") resume(row);
          else {
            const reviews = await api<{ reviews: any[] }>("/boqs/reviews");
            const review = reviews.reviews.find(
              (r) =>
                r.draft_id === initialDraftId && r.status === "Awaiting review",
            );
            if (review) await openReview(review.id);
            else if (row) resume(row);
          }
        }
      })
      .catch(fail);
  }, []);
  function fresh(mode = "Survey") {
    setDesignSource(undefined);
    setSourceMode(mode);
    setPvInput({ qty: 0, wattage: "0" });
    setView("new");
    setBaseRevisionId(undefined);
    setRevisionReason("");
    setRevisionOrigin("Internal management");
    setAdditionalItem(undefined);
    setSpecifications({});
    setTechnicalLines([]);
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
    setDesignSource(d.design_source);
    setSourceMode(d.inputs.sourceMode ?? "Survey");
    setPvInput({
      qty: d.inputs.panelQty ?? 0,
      wattage: d.inputs.panelWattage || "0",
    });
    setBaseRevisionId(d.base_revision_id ?? undefined);
    setRevisionReason(d.revision_reason ?? "");
    setRevisionOrigin(d.revision_origin ?? "Internal management");
    setAdditionalItem(d.inputs.additionalItem);
    setSpecifications(d.inputs.specifications ?? {});
    setTechnicalLines([]);
    setError("");
    setInitial(d.inputs);
    setDraft({ id: d.id, version: d.version });
    setUploads(
      d.inputs.uploadIds.map((id: string, i: number) => ({
        id,
        filename:
          d.design_source?.attachments?.find((a: any) => a.id === id)
            ?.filename ?? `Source document ${i + 1}`,
      })),
    );
    setOcrText(d.inputs.ocrText ?? "");
    setReviewed(d.inputs.ocrReviewed ?? false);
    setPreview(undefined);
    setInverter(d.inputs.inverter ?? "10 kW");
    setView("new");
    setNotice(
      d.comments
        ? `Changes requested: ${d.comments}`
        : "Draft loaded. Review and recalculate before submitting.",
    );
  }
  function read(validate = true) {
    if (!form.current || (validate && !form.current.reportValidity())) return;
    const f = new FormData(form.current);
    return {
      ...(sourceMode === "General quotation"
        ? { sourceMode: "General quotation" }
        : {}),
      customerId: baseRevisionId
        ? initial.customerId
        : f.get("customerId")
          ? Number(f.get("customerId"))
          : undefined,
      siteName: f.get("siteName"),
      siteCode: f.get("siteCode"),
      location: f.get("location"),
      panelQty: f.get("panelQty") ? Number(f.get("panelQty")) : undefined,
      panelWattage: f.get("panelWattage"),
      structure: f.get("structure"),
      dcMetres: sourceMode === "General quotation" ? "0" : f.get("dcMetres"),
      acInverter16:
        sourceMode === "General quotation" ? "0" : f.get("acInverter16"),
      acInverter25:
        sourceMode === "General quotation" ? "0" : f.get("acInverter25"),
      acPanel16: sourceMode === "General quotation" ? "0" : f.get("acPanel16"),
      acPanel25: sourceMode === "General quotation" ? "0" : f.get("acPanel25"),
      earth25: sourceMode === "General quotation" ? "0" : f.get("earth25"),
      earth6: sourceMode === "General quotation" ? "0" : f.get("earth6"),
      earth10: sourceMode === "General quotation" ? "0" : f.get("earth10"),
      bessId: f.get("bessId") || undefined,
      inverter: f.get("inverter") || undefined,
      batteryKwh: f.get("batteryKwh") ? Number(f.get("batteryKwh")) : undefined,
      smartMeter: f.get("smartMeter") === "yes",
      genset: f.get("genset") === "yes",
      brands: Object.fromEntries(
        Object.keys(brandFields)
          .filter((k) => f.get(`brand-${k}`))
          .map((k) => [k, Number(f.get(`brand-${k}`))]),
      ),
      preparedBy: f.get("preparedBy"),
      additionalItem,
      specifications: Object.keys(specifications).length
        ? specifications
        : undefined,
      uploadIds: uploads.map((u) => u.id),
      ocrText,
      ocrReviewed: reviewed,
    };
  }
  async function persist(inputs = read(false)) {
    if (!inputs) return;
    const d = await api<{ id: string; version: number }>("/boqs/drafts", {
      body: {
        id: draft?.id,
        version: draft?.version ?? 0,
        inputs,
        baseRevisionId,
        revisionReason,
        revisionOrigin: baseRevisionId ? revisionOrigin : undefined,
      },
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
      setTechnicalLines(p.snapshot.lines);
      setNotice(
        "Review the costing below, then submit it for approval. No new BOQ number has been issued yet.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function openReview(id: string) {
    setInstructions(blankInstructions());
    setApprovalEvidence([]);
    setExternalApprover("");
    setExternalConfirmed(false);
    setBusy(true);
    setError("");
    try {
      const review = await api<any>(`/boqs/reviews/${id}`);
      setCurrentReview(review);
      setInstructions(review.previous_instructions ?? blankInstructions());
      setChangeQuotationSettings(false);
      setReviewComments("");
      setView("review");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function openSaved(id: string) {
    setBusy(true);
    setError("");
    try {
      const [record, h] = await Promise.all([
        api(`/boqs/${id}`),
        api<{ revisions: any[] }>(`/boqs/${id}/history`),
      ]);
      setSaved(record);
      setHistory(h.revisions);
      setView("saved");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function submitReview() {
    if (!draft || !preview || busy) return;
    if (
      !confirmTransition(
        "Submit costing for review",
        "This sends the current BOQ costing to Management and preserves this review version.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/boqs/reviews", {
        body: {
          draftId: draft.id,
          version: draft.version,
          fingerprint: preview.fingerprint,
        },
        csrf: session.csrfToken,
      });
      await load();
      await openReview(r.id);
      setNotice(
        "Submitted for review. This costing version is preserved until a reviewer approves it or requests changes.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function uploadApproval(file?: File) {
    if (!file || busy) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 8388608
    ) {
      setError("Attach a PNG or JPEG screenshot up to 8 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const uploaded = await api<{ id: string; filename: string }>(
        "/survey-uploads",
        {
          body: { filename: file.name, mime: file.type, base64 },
          csrf: session.csrfToken,
        },
      );
      setApprovalEvidence((old) => [...old, uploaded]);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function recordExternalApproval() {
    if (busy || !currentReview) return;
    if (
      !confirmTransition(
        "Record external costing approval",
        "The attached evidence and quotation instructions will approve this costing and make it ready for quotation.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ saved: any }>(
        `/boqs/reviews/${currentReview.id}/external-approval`,
        {
          body: {
            instructions,
            approver: externalApprover,
            comments: reviewComments,
            evidenceIds: approvalEvidence.map((e) => e.id),
            confirmed: externalConfirmed,
          },
          csrf: session.csrfToken,
        },
      );
      await load();
      await openSaved(result.saved.id);
      setNotice(
        "External costing approval recorded with its screenshots and quotation instructions. The exact costing is saved; you can now prepare the quotation.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    outcome: "Approved" | "Changes requested",
    createQuotation = false,
  ) {
    if (busy || !currentReview) return;
    if (
      !confirmTransition(
        outcome === "Approved" ? "Approve costing" : "Request costing revision",
        outcome === "Approved"
          ? "This freezes the costing and quotation instructions. The Coordinator can proceed to quotation."
          : "This returns the draft to its preparer for changes.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ saved?: any }>(
        `/boqs/reviews/${currentReview.id}/decision`,
        {
          body: {
            outcome,
            comments: reviewComments,
            ...(outcome === "Approved" ? { instructions } : {}),
          },
          csrf: session.csrfToken,
        },
      );
      await load();
      if (result.saved) {
        if (createQuotation && onPricing) {
          onPricing(result.saved.id);
          return;
        }
        await openSaved(result.saved.id);
        setNotice(
          "Approved. The exact costing and your quotation instructions are saved for the Coordinator. Their work queue now shows this BOQ ready for quotation.",
        );
      } else {
        await openReview(currentReview.id);
        setNotice(
          "Changes requested. The preparer can edit this draft and resubmit it.",
        );
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function reviseSaved() {
    if (
      !confirmTransition(
        "Create BOQ revision draft",
        "A separate editable draft will be created. The approved BOQ remains unchanged.",
      )
    )
      return;
    const original = saved;
    setDesignSource(undefined);
    fresh(original.snapshot.survey.sourceMode ?? "Survey");
    setPvInput({
      qty: original.snapshot.survey.panelQty,
      wattage: original.snapshot.survey.panelWattage,
    });
    setBaseRevisionId(original.id);
    setInitial({
      ...original.snapshot.survey,
      preparedBy: session.user.displayName,
    });
    setInverter(original.snapshot.survey.inverter);
    setAdditionalItem(original.snapshot.survey.additionalItem);
    setSpecifications(original.snapshot.survey.specifications ?? {});
    setTechnicalLines(original.snapshot.lines);
    setUploads(
      original.snapshot.survey.uploadIds.map((id: string, i: number) => ({
        id,
        filename: `Source document ${i + 1}`,
      })),
    );
    setOcrText(original.snapshot.survey.ocrText);
    setReviewed(original.snapshot.survey.ocrReviewed);
    setNotice(
      `Revision of ${original.number}. Earlier versions remain unchanged.`,
    );
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
      {addingCustomer && (
        <NewCustomer
          session={session}
          onLogout={onLogout}
          onClose={() => setAddingCustomer(false)}
          onCreated={async (id) => {
            setMasters(await api("/masters"));
            setCreatedCustomerId(id);
            setNotice(
              "Customer added and selected. Continue entering the site details.",
            );
          }}
        />
      )}
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
            <button className="primary" onClick={() => fresh()}>
              New BOQ
            </button>
            <button onClick={() => fresh("General quotation")}>
              Quick BOQ · no survey
            </button>
          </div>
          <p>
            Create a new site from a survey, review the costing, then save an
            approved immutable R0.
          </p>
          <section className="detail-panel review-workspace">
            <h3>
              {["Admin", "Management"].includes(session.user.role)
                ? "Costing review inbox"
                : "My costing submissions"}
            </h3>
            {!reviewRows.length ? (
              <p>No costing submissions yet.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Customer / Site</th>
                      <th>Submitted by</th>
                      <th>Version</th>
                      <th>Status</th>
                      <th>Cost (PKR)</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewRows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.customer}
                          <br />
                          {r.site}
                        </td>
                        <td>{r.submitted_by_name}</td>
                        <td>{r.draft_version}</td>
                        <td>
                          <span className="master-status">{r.status}</span>
                        </td>
                        <td className="numeric">
                          {money(r.total)}
                        </td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => void openReview(r.id)}
                          >
                            Open review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="detail-panel">
            <h3>Survey drafts</h3>
            {drafts.length === 0 ? (
              <p>No saved survey drafts.</p>
            ) : (
              drafts.map((d) => (
                <button
                  key={d.id}
                  className="draft-button"
                  disabled={
                    !!d.review_id && d.review_status === "Awaiting review"
                  }
                  onClick={() => resume(d)}
                >
                  {d.inputs.siteName || "Untitled survey"} ·{" "}
                  {new Date(d.updated_at).toLocaleString()}{" "}
                  {d.review_id && `· ${d.review_status}`}
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
                            onClick={() => void openSaved(r.id)}
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
                          {money(r.total)}
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
      ) : view === "review" ? (
        <>
          <div className="panel-heading">
            <h2>
              Costing review · Draft version {currentReview.draft_version}
            </h2>
            <button onClick={() => setView("list")}>Back to BOQs</button>
          </div>
          <section className="detail-panel">
            <p>
              <strong>{currentReview.status}</strong> · Submitted by{" "}
              {currentReview.submitted_by_name} ·{" "}
              {new Date(currentReview.created_at).toLocaleString()}
            </p>
            <CostingWorkflowHistory review={currentReview} />
            {currentReview.revision_reason && (
              <p>Revision reason: {currentReview.revision_reason}</p>
            )}
            {currentReview.comments && (
              <p>Reviewer feedback: {currentReview.comments}</p>
            )}
            {currentReview.reviewed_by_name && (
              <p>
                {currentReview.approval?.channel === "External chat"
                  ? `External approval by ${currentReview.approval.claimed_approver} · recorded by ${currentReview.approval.recorded_by_name}`
                  : `Reviewed by ${currentReview.reviewed_by_name}`}
              </p>
            )}
            {currentReview.status === "Awaiting review" &&
              ["Admin", "Management"].includes(session.user.role) && (
                <div className="review-actions">
                  {currentReview.previous_instructions && (
                    <label>
                      <input
                        type="checkbox"
                        style={{
                          width: "auto",
                          display: "inline-block",
                          marginRight: 8,
                        }}
                        checked={changeQuotationSettings}
                        onChange={(e) => {
                          setChangeQuotationSettings(e.target.checked);
                          if (!e.target.checked)
                            setInstructions(
                              currentReview.previous_instructions,
                            );
                        }}
                      />{" "}
                      Change quotation settings
                      <span>
                        {" "}
                        Previous quotation instructions are retained unless you
                        enable changes.
                      </span>
                    </label>
                  )}
                  <ApprovalInstructions
                    value={instructions}
                    onChange={setInstructions}
                    disabled={
                      busy ||
                      (!!currentReview.previous_instructions &&
                        !changeQuotationSettings)
                    }
                  />
                  <label>
                    Review comments
                    <textarea
                      value={reviewComments}
                      maxLength={2000}
                      onChange={(e) => setReviewComments(e.target.value)}
                    />
                  </label>
                  <div className="survey-actions">
                    <button
                      disabled={busy || !reviewComments.trim()}
                      onClick={() => void decide("Changes requested")}
                    >
                      Request revision
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void decide("Approved")}
                    >
                      Approve &amp; send to Coordinator
                    </button>
                    {onPricing && (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void decide("Approved", true)}
                      >
                        Approve &amp; create quotation myself
                      </button>
                    )}
                  </div>
                  <p>
                    Sending to Coordinator keeps you out of the quotation
                    editor. Creating it yourself opens pricing with your saved
                    instructions. Approval preserves this exact costing and
                    issues its BOQ revision. Future changes need a new revision.
                  </p>
                </div>
              )}
            {currentReview.status === "Awaiting review" &&
              currentReview.owner_id === session.user.id &&
              session.user.role === "Coordinator" && (
                <section className="detail-panel">
                  <h3>Record approval received outside the app</h3>
                  <p>
                    Share the costing PDF with your Director, then attach the
                    chat screenshots confirming this costing and its quotation
                    margins. This records external approval; it does not claim
                    an authenticated Director action.
                  </p>
                  <label>
                    Approver name
                    <input
                      aria-label="External approver name"
                      value={externalApprover}
                      maxLength={100}
                      onChange={(e) => setExternalApprover(e.target.value)}
                    />
                  </label>
                  {currentReview.previous_instructions && (
                    <label>
                      <input
                        type="checkbox"
                        style={{
                          width: "auto",
                          display: "inline-block",
                          marginRight: 8,
                        }}
                        checked={changeQuotationSettings}
                        onChange={(e) => {
                          setChangeQuotationSettings(e.target.checked);
                          if (!e.target.checked)
                            setInstructions(
                              currentReview.previous_instructions,
                            );
                        }}
                      />{" "}
                      Change quotation settings
                      <span>
                        {" "}
                        Previous quotation instructions are retained unless you
                        enable changes.
                      </span>
                    </label>
                  )}
                  <ApprovalInstructions
                    value={instructions}
                    onChange={setInstructions}
                    disabled={
                      busy ||
                      (!!currentReview.previous_instructions &&
                        !changeQuotationSettings)
                    }
                  />
                  <label>
                    Approval screenshots
                    <input
                      aria-label="Approval screenshots"
                      type="file"
                      accept="image/png,image/jpeg"
                      disabled={busy || approvalEvidence.length >= 10}
                      onChange={(e) => {
                        void uploadApproval(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {approvalEvidence.map((e) => (
                    <p key={e.id}>
                      <span>{e.filename}</span>{" "}
                      <button
                        disabled={busy}
                        onClick={() =>
                          setApprovalEvidence(
                            approvalEvidence.filter((x) => x.id !== e.id),
                          )
                        }
                      >
                        Remove screenshot
                      </button>
                    </p>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={externalConfirmed}
                      onChange={(e) => setExternalConfirmed(e.target.checked)}
                    />
                    I confirm these screenshots approve this exact costing and
                    the quotation instructions entered above.
                  </label>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !externalConfirmed ||
                      !externalApprover.trim() ||
                      !approvalEvidence.length
                    }
                    onClick={() => void recordExternalApproval()}
                  >
                    Record external approval &amp; save BOQ
                  </button>
                </section>
              )}
            {currentReview.approval && (
              <section className="detail-panel">
                <h3>Saved quotation instructions</h3>
                <p>
                  {currentReview.approval.channel} ·{" "}
                  {currentReview.approval.instructions.presentation} ·{" "}
                  {currentReview.approval.instructions.taxMode}
                </p>
                <p>
                  {Object.entries(currentReview.approval.instructions.markups)
                    .map(([k, v]) => `${k}: ${v}%`)
                    .join(" · ")}
                </p>
                <p>{currentReview.approval.instructions.notes}</p>
                {currentReview.approval.evidence?.map((e: any) => (
                  <p key={e.id}>
                    <a href={`/api/boqs/uploads/${e.id}`}>{e.filename}</a>
                  </p>
                ))}
              </section>
            )}
            {currentReview.status === "Changes requested" &&
              currentReview.owner_id === session.user.id &&
              drafts.some(
                (d) =>
                  d.id === currentReview.draft_id &&
                  d.review_id === currentReview.id &&
                  d.review_status === "Changes requested",
              ) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    const d = drafts.find(
                      (d) => d.id === currentReview.draft_id,
                    );
                    if (d) resume(d);
                  }}
                >
                  Edit requested revision
                </button>
              )}
            {currentReview.revision_id && (
              <button
                disabled={busy}
                onClick={() => void openSaved(currentReview.revision_id)}
              >
                Open approved BOQ
              </button>
            )}
          </section>
          <BoqCosting
            snapshot={currentReview.snapshot}
            pdfUrl={`/api/boqs/reviews/${currentReview.id}/costing.pdf`}
          />
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
          <section className="detail-panel">
            <h3>Revision / History</h3>
            {onPricing &&
              ["Admin", "Management", "Coordinator"].includes(
                session.user.role,
              ) && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => onPricing(saved.id)}
                >
                  Create quotation
                </button>
              )}
            <p>
              {saved.revision_origin ?? "Initial / legacy"} ·{" "}
              {saved.revision_reason} · Current view: {saved.number}
            </p>
            <button
              disabled={
                busy || (history.length > 0 && history[0].id !== saved.id)
              }
              onClick={reviseSaved}
            >
              Create revision draft
            </button>
            <p>
              Revision retains the customer, site and sequence. A reason and
              approval are required.
            </p>
            {history.map((r) => (
              <button
                key={r.id}
                className="draft-button"
                disabled={busy}
                onClick={() => void openSaved(r.id)}
              >
                {r.number} · {r.revision_reason}
              </button>
            ))}
          </section>
          <BoqCosting
            pdfUrl={`/api/boqs/${saved.id}/costing.pdf`}
            snapshot={saved.snapshot}
            number={saved.number}
            createdAt={saved.created_at}
          />
        </>
      ) : (
        <>
          <div className="panel-heading">
            <h2>
              {sourceMode === "General quotation"
                ? baseRevisionId
                  ? "Revise general BOQ"
                  : "New general BOQ"
                : baseRevisionId
                  ? "Revise survey & BOQ"
                  : "New survey & BOQ"}
            </h2>
            <button onClick={() => setView("list")} disabled={busy}>
              Back to BOQs
            </button>
          </div>
          <p>
            {baseRevisionId
              ? "This revision uses the existing customer and site. Approval saves a new immutable revision."
              : "A new BOQ creates a new site. Its number is issued when the reviewed costing is approved."}
          </p>
          {baseRevisionId && (
            <label className="source-label">
              Revision source
              <select
                disabled={!!draft}
                aria-label="BOQ revision source"
                value={revisionOrigin}
                onChange={(e) => setRevisionOrigin(e.target.value)}
              >
                <option>Internal management</option>
                <option>Customer</option>
              </select>
              Revision reason
              <textarea
                aria-label="Revision reason"
                value={revisionReason}
                onChange={(e) => {
                  setRevisionReason(e.target.value);
                  setPreview(undefined);
                }}
                maxLength={2000}
                required
              />
            </label>
          )}
          {sourceMode !== "General quotation" && (
            <section className="detail-panel upload-panel">
              <h3>Upload survey information</h3>
              <p>
                Use a survey image, screenshot, PDF (up to 5 pages) or text
                file. OCR runs on your device. Manual entry is always available.
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
          )}
          {sourceMode === "General quotation" && (
            <section className="detail-panel">
              <h3>General quotation · no survey</h3>
              <p>
                Cable quantities are calculated automatically from installed PV
                wattage. These are allowances, not measured site quantities.
              </p>
            </section>
          )}
          {designSource && (
            <aside className="detail-panel" aria-label="Design survey handoff">
              <h3>Survey received from Design</h3>
              <p>
                {designSource.designer} ·{" "}
                {new Date(designSource.sent_at).toLocaleString()}
              </p>
              {designSource.notes && (
                <p style={{ whiteSpace: "pre-wrap" }}>{designSource.notes}</p>
              )}
              <p>
                Review the uploaded survey, select brands and prepare costing.
              </p>
            </aside>
          )}
          <form
            ref={form}
            className="survey-form"
            onSubmit={calculate}
            onChange={() => {
              setPreview(undefined);
              setNotice("");
              if (form.current) {
                const fields = new FormData(form.current);
                setPvInput({
                  qty: Number(fields.get("panelQty")) || 0,
                  wattage: String(fields.get("panelWattage") || "0"),
                });
              }
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
                    disabled={!!baseRevisionId}
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
                  {!baseRevisionId &&
                    canWriteMaster(session.user.role, "customers", "new") && (
                      <button
                        type="button"
                        onClick={() => setAddingCustomer(true)}
                      >
                        Add customer
                      </button>
                    )}
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
                    readOnly={!!baseRevisionId}
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
            {sourceMode === "General quotation" && (
              <section className="detail-panel">
                <h3>Automatic cable allowances</h3>
                <p>
                  Installed PV:{" "}
                  {
                    generalAllowances(
                      pvInput.qty,
                      pvInput.wattage,
                      inverter.startsWith("2×") ? 2 : 1,
                    ).pvWatts
                  }{" "}
                  W
                </p>
                <dl className="survey-grid">
                  {Object.entries(
                    generalAllowances(
                      pvInput.qty,
                      pvInput.wattage,
                      inverter.startsWith("2×") ? 2 : 1,
                    ),
                  )
                    .filter(([k]) => !["pvWatts", "dcMetres"].includes(k))
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>
                          {
                            {
                              dcRed: "DC cable · red",
                              dcBlack: "DC cable · black",
                              earth25: "2.5mm² earthing",
                              earth6: "6mm² earthing",
                              earth10: "10mm² earthing",
                              ac16: "16mm² AC cable",
                              ac25: "25mm² AC cable",
                            }[k]
                          }
                        </dt>
                        <dd>{v} m</dd>
                      </div>
                    ))}
                </dl>
              </section>
            )}
            <fieldset disabled={busy}>
              <legend>
                2 ·{" "}
                {sourceMode === "General quotation"
                  ? "PV capacity & solution"
                  : "Survey quantities & solution"}
              </legend>
              <div className="survey-grid">
                {Object.entries(quantities)
                  .filter(([k]) => k !== "batteryKwh")
                  .filter(
                    ([k]) =>
                      sourceMode !== "General quotation" ||
                      ![
                        "dcMetres",
                        "earth25",
                        "earth6",
                        "earth10",
                        "acInverter16",
                        "acInverter25",
                        "acPanel16",
                        "acPanel25",
                      ].includes(k),
                  )
                  .map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        name={k}
                        aria-label={label}
                        type="number"
                        required
                        min={
                          k === "panelQty"
                            ? 1
                            : k === "panelWattage"
                              ? 0.0001
                              : 0
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
                          k.startsWith("ac") ||
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
                <BessSelector initial={initial} onChange={setInverter} />
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
            <fieldset disabled={busy}>
              <legend>
                Additional scope — included in BOQ costing and approval
              </legend>
              <label>
                <input
                  type="checkbox"
                  checked={!!additionalItem}
                  onChange={(e) => {
                    setAdditionalItem(
                      e.target.checked
                        ? {
                            description: "Additional item",
                            specification: "",
                            qty: "1",
                            unit: "LS",
                            unitCost: "0",
                            taxRate: "18",
                          }
                        : undefined,
                    );
                    setPreview(undefined);
                  }}
                />
                Include an additional costing item
              </label>
              {additionalItem && (
                <div className="survey-grid">
                  {[
                    ["description", "Additional item description"],
                    [
                      "specification",
                      "Additional item technical specification",
                    ],
                    ["qty", "Additional item quantity"],
                    ["unit", "Additional item unit"],
                    ["unitCost", "Additional item unit cost (PKR)"],
                  ].map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        aria-label={label}
                        value={additionalItem[k]}
                        required={k !== "specification"}
                        type={
                          k === "qty" || k === "unitCost" ? "number" : "text"
                        }
                        min={k === "qty" ? "0.0001" : "0"}
                        step="0.0001"
                        maxLength={1500}
                        onChange={(e) => {
                          setAdditionalItem({
                            ...additionalItem,
                            [k]: e.target.value,
                          });
                          setPreview(undefined);
                        }}
                      />
                    </label>
                  ))}
                  <label>
                    Additional item tax category
                    <select
                      aria-label="Additional item tax category"
                      value={additionalItem.taxRate}
                      onChange={(e) => {
                        setAdditionalItem({
                          ...additionalItem,
                          taxRate: e.target.value,
                        });
                        setPreview(undefined);
                      }}
                    >
                      <option value="18">Other items — 18%</option>
                      <option value="10">Solar — 10%</option>
                      <option value="0">No tax — 0%</option>
                    </select>
                  </label>
                </div>
              )}
            </fieldset>
            {baseRevisionId && technicalLines.length > 0 && (
              <details className="revision-specifications">
                <summary>Review / change technical specifications</summary>
                <fieldset disabled={busy}>
                  <legend>BOQ revision technical specifications</legend>
                  <p>
                    Changes are saved in this BOQ revision and require costing
                    review.
                  </p>
                  {technicalLines
                    .filter((l) => l.key !== "Additional Item")
                    .map((l) => (
                      <label className="source-label" key={l.key}>
                        {l.description}
                        <textarea
                          aria-label={`BOQ specification: ${l.key}`}
                          value={specifications[l.key] ?? l.specification ?? ""}
                          maxLength={1500}
                          onChange={(e) => {
                            const next = { ...specifications };
                            if (e.target.value.trim())
                              next[l.key] = e.target.value;
                            else delete next[l.key];
                            setSpecifications(next);
                            setPreview(undefined);
                          }}
                        />
                      </label>
                    ))}
                </fieldset>
              </details>
            )}
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
                {sourceMode === "General quotation"
                  ? "Save general BOQ draft"
                  : "Save survey draft"}
              </button>
              <button className="primary" disabled={busy} type="submit">
                {busy ? "Processing…" : "Calculate & review BOQ"}
              </button>
            </div>
          </form>
          {preview && (
            <>
              <BoqCosting
                snapshot={preview.snapshot}
                pdfUrl={`/api/boqs/drafts/${draft?.id}/costing.pdf?fingerprint=${preview.fingerprint}`}
              />
              <div className="save-boq-panel">
                <p>
                  Submit this exact costing for approval. If changes are
                  requested, edit the draft and resubmit.
                </p>
                <button
                  className="primary"
                  disabled={busy || (uploads.length > 0 && !reviewed)}
                  onClick={() => {
                    void submitReview();
                  }}
                >
                  Submit for review
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
