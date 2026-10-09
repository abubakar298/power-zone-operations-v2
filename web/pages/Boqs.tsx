import {confirmLeaveWorkspace,useUnsavedChanges} from "../hooks/useUnsavedChanges.js";
import { DirectProductFields } from "../components/DirectProductFields.js";
import { StandardSellingSummary } from "../components/StandardSellingSummary.js";
import { CniProposals } from "./CniProposals.js";
import { money } from "../numbers.js";
import { SurveyQuantityFields } from "../components/SurveyQuantityFields.js";
import { CostingWorkflowHistory } from "../components/CostingWorkflowHistory.js";
import { confirmTransition } from "../confirm.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Session } from "../api.js";
import { CustomerSiteFields } from "../components/CustomerSiteFields.js";
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
  initialCniId, startNew, initialBoqId, initialContext,
}: {
  session: Session;
  onLogout: () => void;
  onPricing?: (id: string) => void;
  initialDraftId?: string;
  initialCniId?: string; startNew?: boolean; initialBoqId?: string; initialContext?:any;
}) {
  const [boqFamily, setBoqFamily] = useState(initialCniId ? "ci-bess" : "solar-hybrid");
  const [dirty,setDirty]=useState(false),[cniContext,setCniContext]=useState<any>(initialContext);
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
  const [revisionMode, setRevisionMode] = useState(false);
  const [revisionCustomer, setRevisionCustomer] = useState("");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [createdCustomerId, setCreatedCustomerId] = useState<string>();
  const form = useRef<HTMLFormElement>(null);
  useUnsavedChanges(dirty && view === "new" && boqFamily !== "ci-bess");
  function selectFamily(value:string){
    if(value===boqFamily)return;
    if(value==="ci-bess" && dirty&&!confirmLeaveWorkspace())return;
    if(form.current){const fields=new FormData(form.current);setCniContext({customerId:fields.get('customerId'),siteName:fields.get('siteName'),siteCode:fields.get('siteCode'),location:fields.get('location')});}
    setBoqFamily(value);setPreview(undefined);setNotice('');setDirty(value!=='ci-bess');
  }
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
        if (initialBoqId) await openSaved(initialBoqId);
        else if (startNew) fresh();
        else if (initialDraftId) {
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
    if(!confirmLeaveWorkspace())return false;
    setDirty(false);
    setDesignSource(undefined);
    setCreatedCustomerId(undefined);
    setSourceMode(mode);
    setPvInput({ qty: 0, wattage: "0" });
    setView("new");
    setBaseRevisionId(undefined);
    setRevisionReason("");
    setRevisionOrigin("Internal management");
    setAdditionalItem(undefined);
    setSpecifications({});
    setTechnicalLines([]);
    setQuantityPatch({});
    setInitial(initialContext??{});
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
    setRevisionMode(false);
    setRevisionCustomer("");
    return true;
  }
  function resume(d: any) {
    setDirty(false);
    setCreatedCustomerId(undefined);
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
    setQuantityPatch({});
    setInitial(d.inputs);
    setCniContext(d.inputs);
    setBoqFamily(d.inputs.family ?? "solar-hybrid");
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
    if (revisionMode && !baseRevisionId) { setError("Select the original BOQ before entering a revision."); return; }
    if (!form.current || (validate && !form.current.reportValidity())) return;
    const f = new FormData(form.current);
    return {
      ...(sourceMode === "General quotation"
        ? { sourceMode: "General quotation" }
        : {}),
      family: boqFamily === "direct-product" ? "direct-product" : boqFamily === "bess-only" ? "bess-only" : "solar-hybrid",
      ...(boqFamily === "direct-product" ? {directProducts:JSON.parse(String(f.get("directProducts") || "[]"))} : {}),
      customerId: baseRevisionId
        ? initial.customerId
        : f.get("customerId")
          ? Number(f.get("customerId"))
          : undefined,
      siteName: f.get("siteName"),
      siteCode: f.get("siteCode"),
      location: f.get("location"),
      panelQty: boqFamily === "direct-product" || boqFamily === "bess-only" ? 0 : f.get("panelQty") ? Number(f.get("panelQty")) : undefined,
      panelWattage: boqFamily === "direct-product" || boqFamily === "bess-only" ? "0" : f.get("panelWattage"),
      structure: boqFamily === "direct-product" || boqFamily === "bess-only" ? "L1" : f.get("structure"),
      dcMetres: boqFamily === "direct-product" || boqFamily === "bess-only" ? "0" : sourceMode === "General quotation" ? "0" : f.get("dcMetres"),
      acTerminationMode: sourceMode === "General quotation" ? "Fixed" as const : "Measured" as const,
      acInverter16: f.get("acInverter16") || "0",
      acInverter25: f.get("acInverter25") || "0",
      spInverterTerminationMetres: f.get("spInverterTerminationMetres") || undefined,
      acPanel16: sourceMode === "General quotation" ? "0" : f.get("acPanel16") || "0",
      acPanel25: sourceMode === "General quotation" ? "0" : f.get("acPanel25") || "0",
      earth25: boqFamily === "direct-product" || boqFamily === "bess-only" || sourceMode === "General quotation" ? "0" : f.get("earth25"),
      earth6: sourceMode === "General quotation" || (boqFamily === "bess-only" && f.get("inverter") !== "6 kW SP") ? "0" : f.get("earth6") || "0",
      earth10: sourceMode === "General quotation" || (boqFamily === "bess-only" && f.get("inverter") === "6 kW SP") ? "0" : f.get("earth10") || "0",
      spLoadPanelRunMetres: f.get("spLoadPanelTotalMetres") ? String(Number(f.get("spLoadPanelTotalMetres")) / 2) : undefined,
      bessId: f.get("bessId") || undefined,
      inverter: boqFamily === "direct-product" ? "Products" : f.get("inverter") || undefined,
      batteryKwh: boqFamily === "direct-product" ? 0 : f.get("batteryKwh") ? Number(f.get("batteryKwh")) : undefined,
      smartMeter: f.get("smartMeter") === "yes",
      genset: f.get("genset") === "yes",
      spIncludeEarthingBore:f.get("spIncludeEarthingBore") === "on",
      brands: Object.fromEntries(
        Object.keys(brandFields)
          .filter((k) => f.get(`brand-${k}`))
          .map((k) => [k, Number(f.get(`brand-${k}`))]),
      ),
      preparedBy: f.get("preparedBy"),
      additionalItem:boqFamily === "direct-product" ? undefined : additionalItem,
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
    setDirty(false);
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
        "Review the BOQ and visible costing below, then create a quotation for Management approval. No new BOQ number has been issued yet.",
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
    if (!confirmTransition("Create quotation", "Save this exact BOQ and prepare its standard commercial quotation. Management reviews the final quotation.")) return;
    setBusy(true);setError("");
    try {
      const r=await api<{id:string}>("/boqs/save",{body:{draftId:draft.id,version:draft.version,fingerprint:preview.fingerprint},csrf:session.csrfToken});
      await load();
      if(onPricing)onPricing(r.id);else setNotice("BOQ saved. Open Commercial pricing to prepare the quotation.");
    }catch(e){fail(e);}finally{setBusy(false);}
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
  function reviseSaved(selected = saved) {
    if (
      !confirmTransition(
        "Create BOQ revision draft",
        "A separate editable draft will be created. The approved BOQ remains unchanged.",
      )
    )
      return;
    const original = selected;
    setDesignSource(undefined);
    if (!fresh(original.snapshot.survey.sourceMode ?? "Survey")) return;
    setPvInput({
      qty: original.snapshot.survey.panelQty,
      wattage: original.snapshot.survey.panelWattage,
    });
    setBaseRevisionId(original.id);
    setBoqFamily(original.snapshot.survey.family ?? "solar-hybrid");
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
  const [quantityPatch, setQuantityPatch] = useState<Record<string,string>>({});
  function applySuggestions() {
    if (!form.current) return;
    for (const [key, value] of Object.entries(suggestions)) {
      const input = form.current.elements.namedItem(key);
      if (input instanceof HTMLInputElement) input.value = value;
    }
    setQuantityPatch({...suggestions});
    setPreview(undefined);
    setReviewed(false);
    setNotice(
      "Recognised values applied. Check every field against the source before saving.",
    );
  }
  if (!masters)
    return <p role="status">{error || "Loading project references…"}</p>;
  if (boqFamily === "ci-bess") return <CniProposals initialProposalId={initialCniId} initialContext={cniContext} session={session} onLogout={onLogout} masters={masters} onBack={() => {setBoqFamily("solar-hybrid");setInitial(cniContext??initialContext??{});}} />;
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
            Select a site or create a new one, review the costing, then save an
            immutable BOQ revision, then prepare its quotation for Management approval.
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
                        <td className="numeric">{money(r.total)}</td>
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
                        <td className="numeric">{money(r.total)}</td>
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
              onClick={() => reviseSaved()}
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
            <button onClick={() => {if(confirmLeaveWorkspace()){setDirty(false);setView("list");}}} disabled={busy}>
              Back to BOQs
            </button>
          </div>
          <p>
            {baseRevisionId
              ? "This revision uses the existing customer and site. Approval saves a new immutable revision."
              : "Search and select a customer, then enter the site name. Use Revision mode for changes to an existing BOQ."}
          </p>
          {!baseRevisionId && <section className="boq-entry-mode" aria-label="BOQ entry mode">
            <label>Document action<select aria-label="Document action" value={revisionMode ? "revision" : "new"} onChange={e => setRevisionMode(e.target.value === "revision")}><option value="new">New BOQ</option><option value="revision">Revise an existing BOQ</option></select></label>
            {revisionMode && <>
              <p>For Management-requested changes, open Revision Requested in your dashboard. To start your own revision, select the original BOQ below.</p>
              <label>Revision customer<select aria-label="Revision customer" value={revisionCustomer} onChange={e => setRevisionCustomer(e.target.value)}><option value="">Select customer</option>{masters.customers.filter((c: any) => records.some(r => String(r.customer_id) === String(c.id))).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Original BOQ<select aria-label="Original BOQ" disabled={!revisionCustomer || busy} value="" onChange={async e => { if (!e.target.value) return; setBusy(true); try { const original = await api<any>(`/boqs/${e.target.value}`); reviseSaved(original); setRevisionMode(false); } catch(error) { fail(error); } finally { setBusy(false); } }}><option value="">Select BOQ to load original values</option>{records.filter(r => String(r.customer_id) === revisionCustomer).map(r => <option key={r.id} value={r.id}>{r.number} · {r.site}</option>)}</select></label>
            </>}
          </section>}
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
          {sourceMode === "General quotation" && boqFamily === "solar-hybrid" && (
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
          {!revisionMode && <form
            ref={form}
            className="survey-form"
            onSubmit={calculate}
            onChange={() => {
              setDirty(true);
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
              <legend>1 · Customer & site</legend>
              <div className="survey-grid">
                <CustomerSiteFields
                  masters={masters}
                  initial={initial}
                  revision={!!baseRevisionId}
                  preferredCustomer={createdCustomerId}
                  onAdd={
                    canWriteMaster(session.user.role, "customers", "new")
                      ? () => setAddingCustomer(true)
                      : undefined
                  }
                />
              </div>
            </fieldset>
          <div className="boq-family-field">
            <label>BOQ type<select aria-label="BOQ type" disabled={busy || !!baseRevisionId} value={boqFamily} onChange={e => selectFamily(e.target.value)}>
              <option value="solar-hybrid">Solar Hybrid Project</option>
              <option value="ci-bess">C&amp;I BESS</option>
              <option value="bess-only">BESS Only (UPS with Installation)</option>
              <option value="direct-product">Direct Product Sale</option>
            </select></label>
            <small>Select what you are preparing. Only the applicable inputs appear below.</small>
          </div>
            {boqFamily !== "direct-product" && <div className="boq-family-field"><label>Input method<select aria-label="Input method" value={sourceMode} disabled={busy || !!designSource} onChange={e=>{setSourceMode(e.target.value);setPreview(undefined);setDirty(true);}}><option value="Survey">Survey · measured site inputs</option><option value="General quotation">Quick BOQ · approved allowances</option></select></label><small>{sourceMode==='Survey'?'Enter measured quantities or upload the survey. Auto-filled inverter allowances remain editable.':'Derived allowances are calculated by the existing approved rules. Check them before preparing a quotation.'}</small></div>}
            <p className="workspace-help">{boqFamily==='direct-product'?'Select products and quantities. Survey, cables and installation inputs are excluded.':boqFamily==='bess-only'?'Select BESS equipment and AC integration. Solar panels, structures and DC scope are excluded.':'Select PV, BESS and the applicable AC/DC scope. Derived values are identified beside their inputs.'}</p>
          {sourceMode !== "General quotation" && boqFamily !== "direct-product" && (
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
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDirty(true);
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
                      <button type="button" disabled={busy} onClick={applySuggestions}>
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
            {sourceMode === "General quotation" && boqFamily === "solar-hybrid" && (
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
                    .filter(([k]) => inverter !== "6 kW SP" || !["ac16", "ac25"].includes(k))
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
                {inverter === "6 kW SP" && <p>10mm² single-core AC cable: 20 m inverter termination + 40 m load-panel conductors (20 m estimated route × line and neutral).</p>}
              </section>
            )}
            <fieldset disabled={busy}>
              <legend>
                2 ·{" "}
                {sourceMode === "General quotation"
                  ? boqFamily === "bess-only" ? "BESS & AC solution" : "PV capacity & solution"
                  : boqFamily === "direct-product" ? "Products & quantities" : "Survey quantities & solution"}
              </legend>
              {boqFamily === "direct-product" ? <DirectProductFields masters={masters} initial={initial.directProducts}/> : <SurveyQuantityFields key={`${baseRevisionId ?? "new"}-${initial.bessId ?? ""}`} initial={initial} patch={quantityPatch} inverter={inverter} quick={sourceMode === "General quotation"} bessOnly={boqFamily === "bess-only"} onInverter={setInverter} />}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>3 · Brands & preparation</legend>
              <div className="survey-grid">
                {Object.entries(brandFields).filter(([k])=>boqFamily !== "direct-product" && (boqFamily !== "bess-only" || k !== "solar")).map(([k, category]) => (
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
            {boqFamily !== "direct-product" && <fieldset disabled={busy}>
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
            </fieldset>}
            {baseRevisionId && technicalLines.length > 0 && (
              <details className="revision-specifications">
                <summary>Review / change technical specifications</summary>
                <fieldset disabled={busy}>
                  <legend>BOQ revision technical specifications</legend>
                  <p>
                    Changes are saved in this BOQ revision and return through quotation approval.
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
          </form>}
          {preview && (
            <>
              <BoqCosting
                snapshot={preview.snapshot}
                pdfUrl={`/api/boqs/drafts/${draft?.id}/costing.pdf?fingerprint=${preview.fingerprint}`}
              />
              {["Admin","Management"].includes(session.user.role) && <StandardSellingSummary snapshot={preview.snapshot}/>}
              <div className="save-boq-panel">
                <p>
                  {preview.snapshot.engineering.releaseReady === false
                    ? "Electrical verification is pending. Commercial preparation is enabled; check the costing and create the quotation for Management review."
                    : "Check this costing, then create the quotation at standard policy prices. Management reviews the quotation."}
                </p>
                <button
                  className="primary"
                  disabled={busy || (uploads.length > 0 && !reviewed)}
                  onClick={() => {
                    void submitReview();
                  }}
                >
                  Create quotation
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
