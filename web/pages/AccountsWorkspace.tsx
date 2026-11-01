import {AccountsCustomerDocuments} from './AccountsCustomerDocuments.js';
import {EvidencePreview} from '../components/EvidencePreview.js';
import {accountsPageName} from '../../shared/accounts-navigation.js';
import {ProgrammeDashboard} from '../components/ProgrammeDashboard.js';
import {isClosurePreparationJob} from '../../shared/accounts-closure-queue.js';
import {ClosureComparison} from "../components/ClosureComparison.js";
import {AccountsImportedSites} from './AccountsImportedSites.js';
import {isDeliveryOnlyDo,accountsDocumentLabel} from '../workspaces/accounts-document-types.js';
import {AccountsRecordDialog} from '../components/AccountsRecordDialog.js';
import {AccountsPayments} from './AccountsPayments.js';
import {AccountsBilling} from './AccountsBilling.js';
import {AccountsPhysicalDocuments} from './AccountsPhysicalDocuments.js';
import {FileUpload} from '../ui/FileUpload.js';
import { cableInvoiceAdjustment } from "../../server/inventory/reconciliation.js";
import { jobLabel } from "../components/job-label.js";
import { ProjectCheckpoints } from "./ProjectCheckpoints.js";
import { lazy, useEffect, useRef, useState } from "react";
import { api, type Session } from "../api.js";
import { Button } from "../ui/Button.js";
import { Field } from "../ui/Field.js";
import { decimalDisplay, wholeMoney as money } from "../numbers.js";
import { InventoryWorkspace } from "./InventoryWorkspace.js";
const Departments = lazy(() =>
  import("./Departments.js").then((module) => ({ default: module.Departments })),
);
import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
import { confirmRevision } from "../confirm.js";
import { quotationDisplayRows } from "../../server/commercial/quotation-rows.js";
import { orderCustomerScopeLines } from "../../server/commercial/customer-scope.js";
import { DocumentPreview } from "../components/AccountsDocumentPreview.js";
import {
  ClosureCostTables,
  ClosureIndicators,
  installationDays,
} from "../components/ClosurePerformance.js";
import { Decimal } from "decimal.js";
const phases = ["Solar Panels", "Structure", "Inverter", "Batteries", "BMS"];
function closureDecisionNote(snapshot: any): string | null {
  for (const value of [snapshot?.decision?.notes, snapshot?.returnReason])
    if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
/** Format quantity prefixes only; retain item codes and equipment specifications verbatim. */
function ptQuantityDescription(description?: string) {
  return description?.replace(/(^|[;\n]\s*)(\d[\d,]*(?:\.\d+)?)(?=\s+(?:(?:W|kW|No\.?|Nos\.?|m|meters?|pcs|units?)(?: costing basis)?\s+)?[x×]\s)/gi,
    (_match, prefix, quantity) => {
      const value = new Decimal(quantity.replaceAll(',', ''));
      return prefix + decimalDisplay(value.toString(), 0);
    }) || "Description not recorded";
}

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
  managementReview = false,
  onBack,
  onDecision,
  initialTab,
  onContextChange,
}: {
  session: Session;
  initialRecordId?: string;
  initialJobKey?: string;
  managementReview?: boolean;
  onBack?: () => void;
  onDecision?: () => void;
  initialTab?: string;
  onContextChange?: (title:string|null)=>void;
}) {
  const confirmationPending=useRef(false);
  async function confirmAccountsAction(action:string,detail:string,label:string){
    if(confirmationPending.current)return false;
    confirmationPending.current=true;
    try{return await confirmRevision(action,detail,label);}finally{confirmationPending.current=false;}
  }
  const [inventoryReport,setInventoryReport]=useState<any>();
  const inventoryDocumentRequest=useRef(0);
  const [inventoryType,setInventoryType]=useState<string|null>(null),[doDocument,setDoDocument]=useState<any>(),
    [ptDocument,setPtDocument]=useState<any>(),
    [ptEntryReference,setPtEntryReference]=useState(""),
    [ptEntryDate,setPtEntryDate]=useState(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Karachi"}).format(new Date())),
    [ptEntryNotes,setPtEntryNotes]=useState(""),
    [programmeSiteKey,setProgrammeSiteKey]=useState<string>(),
    [tab, setTab] = useState(
      initialRecordId ? "IPO Review" : initialJobKey ? "Job Closure" : accountsPageName(initialTab),
    ),
    [data, setData] = useState<any>({ ipos: [], closures: [] }),
    [inventoryReports, setReports] = useState<any[]>([]),
    [approvedDocumentCount,setApprovedDocumentCount]=useState<number|null>(null),
    [invoiceQueueCount,setInvoiceQueueCount]=useState<number|null>(null),
    [paymentQueueCount,setPaymentQueueCount]=useState<number|null>(null),
    [queueCountError,setQueueCountError]=useState(false),
    [selected, setSelected] = useState<any>(),
    [samplePreview, setSamplePreview] = useState<any>(),
    [job, setJob] = useState<any>(),
    [actual, setActual] = useState<Record<string, string>>({}),
    [epcAggregate, setEpcAggregate] = useState(""),
    [epcDetails, setEpcDetails] = useState(false),
    [epc, setEpc] = useState<Record<string, string>>({}),
    [remarks, setRemarks] = useState(""),
    [ack, setAck] = useState(""),
    [photos, setPhotos] = useState(""),
    [pt, setPt] = useState(""),
    [ptAttachmentId, setPtAttachmentId] = useState<string | null>(null),
    [notes, setNotes] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorAction, setErrorAction] = useState(""),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState(""),
    [legacy, setLegacy] = useState(false);
  useEffect(()=>{onContextChange?.(job?'Job Closure':tab==='IPO Review'&&selected?'IPO Review':null);return()=>onContextChange?.(null);},[job,tab,selected,onContextChange]);
  const selectedIpoSource=selected?data.ipos?.find((r:any)=>r.id===selected.ipo.id):null;
  const ipoReceivedDate=selectedIpoSource?.received_at??selectedIpoSource?.created_at??selected?.ipo?.created_at;
  const ipoReceivedLabel=ipoReceivedDate&&!Number.isNaN(Date.parse(ipoReceivedDate))?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'}).format(new Date(ipoReceivedDate)):null;
  const [editingSubmitted,setEditingSubmitted]=useState(false),[amendmentReason,setAmendmentReason]=useState("");
  const input = {
    actual,
    epc,
    epcAggregate,
    epcDetails,
    remarks,
    ack,
    photos,
    pt,
    ptAttachmentId,
  };
  const dirty = (!!job && (JSON.stringify(input) !== saved||editingSubmitted&&!!amendmentReason.trim())) || (!!selected && !!notes.trim()) || (!!ptDocument && (!!ptEntryReference || !!ptEntryNotes));
  useUnsavedChanges(dirty);
  const manager = ["Admin", "Management"].includes(session.user.role);
  const latest = job?.history[0];
  const revisionReason = latest?.stage === "Returned for Revision" ? closureDecisionNote(latest.snapshot) : null;
  const readonly = latest?.stage==="Closed"||latest?.stage==="Awaiting Management"&&!editingSubmitted;
  const workspaceNeeded = !['Project Tracking','Programme Dashboard','Project Sites','Physical Documents','Receivables','Invoicing','Invoices to Submit','Payments to Record','Project checkpoints','Inventory Reconciliations','Approved Documents'].includes(tab);
  const reportsNeeded = ['My Workspace','Inventory PT Entries','Inventory Recorded in PT','Job Closure'].includes(tab);
  const loadGeneration = useRef(0);
  const actorContext = `${session.user.id}:${session.user.role}`;
  const currentActor = useRef(actorContext);
  currentActor.current = actorContext;
  useEffect(()=>{
    if(tab!=='My Workspace')return;
    let active=true,generation=0;
    setInvoiceQueueCount(null);setPaymentQueueCount(null);setQueueCountError(false);
    const refresh=()=>{const request=++generation;void api<{invoicesToSubmit:number;paymentsToRecord:number}>('/accounts-workspace/work-queues').then(result=>{
      if(active&&request===generation){setInvoiceQueueCount(result.invoicesToSubmit);setPaymentQueueCount(result.paymentsToRecord);setQueueCountError(false);}
    }).catch(()=>{if(active&&request===generation){setInvoiceQueueCount(null);setPaymentQueueCount(null);setQueueCountError(true);}});};
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',visible);
    return()=>{active=false;generation++;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',visible);};
  },[tab,actorContext]);
  useEffect(()=>{if(tab!=='My Workspace')return;let active=true,request=0;const refresh=()=>{const current=++request;void api<{count:number}>('/accounts-workspace/customer-documents?summary=1').then(v=>{if(active&&current===request)setApprovedDocumentCount(v.count);}).catch(()=>{if(active&&current===request)setApprovedDocumentCount(null);});};setApprovedDocumentCount(null);refresh();window.addEventListener('focus',refresh);return()=>{active=false;window.removeEventListener('focus',refresh);};},[tab,actorContext]);
  async function load() {
    if (!workspaceNeeded && !reportsNeeded) return;
    const generation = ++loadGeneration.current;
    const [d, r] = await Promise.all([
      workspaceNeeded ? api<any>("/accounts-workspace") : Promise.resolve(null),
      reportsNeeded ? api<any>("/inventory-reconciliation/reports") : Promise.resolve(null),
    ]);
    if (generation !== loadGeneration.current || currentActor.current !== actorContext) return;
    if (d) setData(d);
    if (r) setReports(r.reports.filter((x: any) => x.stage === "Sent to Accounts"));
  }
  useEffect(() => {
    let active = true;
    void load().catch((e) => { if (active && currentActor.current === actorContext) setError(e.message); });
    return () => { active = false; loadGeneration.current++; };
  }, [workspaceNeeded, reportsNeeded, actorContext]);
  useEffect(() => {
    if (initialRecordId) void openIpo(initialRecordId);
    if (initialJobKey) void openJob(initialJobKey);
  }, []);
  async function navigate(t: string) {
    if (
      dirty &&
      !readonly &&
      !(await confirmRevision(
        selected ? "Leave IPO review" : ptDocument ? "Leave PT entry" : "Leave closure entry",
        selected ? "Discard the unsaved review note?" : ptDocument ? "Discard the unsaved PT reference and notes?" : "Save a draft to retain your changes.",
        "Leave page",
      ))
    )
      return;
    setPtDocument(undefined);setPtEntryReference("");setPtEntryNotes("");
    setTab(t);
    window.scrollTo(0,0);
    setJob(undefined);
    setSelected(undefined);
    setSamplePreview(undefined);
    setNotes("");
    setError("");
    setMessage("");
  }
  async function openInventoryDocuments(record:any){
    const request=++inventoryDocumentRequest.current;
    setDoDocument({record,loading:true});
    try{
      const [detail,qc]=await Promise.all([api<any>('/inventory-reconciliation/reports/'+record.id),api<any>('/accounts-workspace/customer-documents?jobKey='+encodeURIComponent(record.job_key))]);
      const current=detail.versions?.[0];
      if(current&&(current.stage!=='Sent to Accounts'||current.version!==record.version))throw Error('This document has changed. Refresh the approved documents queue.');
      if(request!==inventoryDocumentRequest.current)return;
      setDoDocument({record,files:detail.files??record.files??[],signedFiles:qc.rows??[],version:current});
    }catch(e){if(request===inventoryDocumentRequest.current)setDoDocument({record,error:(e as Error).message});}
  }
  async function savePtEntry(){
    if(!ptDocument||busy)return;
    setErrorAction('pt-entry');setError('');
    if(!ptEntryReference.trim()||!ptEntryDate){setError('Enter the PT reference and entry date.');return;}
    setBusy(true);
    try{
      await api('/accounts-workspace/pt-entries',{csrf:session.csrfToken,body:{sourceKind:ptDocument.kind,sourceId:ptDocument.id,sourceVersion:ptDocument.kind==='IPO'?1:ptDocument.version,ptReference:ptEntryReference,entryDate:ptEntryDate,notes:ptEntryNotes}});
      await load();setPtDocument(undefined);setPtEntryReference('');setPtEntryNotes('');setMessage('PT entry recorded against this document version.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function closePtEntry(){
    if((ptEntryReference||ptEntryNotes)&&!(await confirmAccountsAction('Close PT entry','Discard the unsaved PT reference and notes?','Discard changes')))return;
    setPtDocument(undefined);setPtEntryReference('');setPtEntryNotes('');
  }
  async function openIpo(id: string) {
    setBusy(true);
    try {
      setSamplePreview(undefined);
      setNotes("");
      setSelected(await api("/accounts-workspace/ipos/" + id));
      setTab("IPO Review");
      window.scrollTo(0,0);
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
      !(await confirmRevision(
        decision === "Verified" ? "Verify IPO" : "Return IPO for revision",
        decision === "Verified" ? "Record this IPO as verified by Accounts? PT entry must still be recorded separately." : "Return this IPO for revision with the reason entered above?",
        decision === "Verified" ? "Verify IPO" : "Return for revision",
      ))
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
  async function openJob(key: string,editSubmitted=false) {
    setBusy(true);
    try {
      const j = await api<any>(
        "/accounts-workspace/job?key=" + encodeURIComponent(key),
      );
      setEditingSubmitted(editSubmitted&&j.history[0]?.stage==="Awaiting Management"&&!managementReview);setAmendmentReason("");
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
        ptAttachmentId: i?.ptAttachmentId ?? null,
      };
      const submitted = j.history[0];
      // Review the immutable submitted figures, even if the current source
      // budget changed afterward. Drafts continue using their current basis.
      setJob(submitted && ["Awaiting Management", "Closed"].includes(submitted.stage)
        ? { ...j, ...submitted.snapshot, history: j.history,
            phaseCostComparison: j.phaseCostComparison,
            configurationComparison: j.configurationComparison }
        : j);
      setActual(v.actual);
      setEpc(v.epc);
      setEpcAggregate(v.epcAggregate);
      setEpcDetails(v.epcDetails);
      setRemarks(v.remarks);
      setAck(v.ack);
      setPhotos(v.photos);
      setPt(v.pt);
      setPtAttachmentId(v.ptAttachmentId);
      setSaved(JSON.stringify(v));
      setTab("Job Closure");
      window.scrollTo(0,0);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reviewWorkflowIpo(approve: boolean) {
    if (!samplePreview || busy) return;
    setErrorAction("workflow-ipo");
    setError("");
    if (!notes.trim()) {
      setError("Enter the Accounts review remarks or revision reason.");
      return;
    }
    if (
      !(await confirmAccountsAction(
        approve ? "Approve IPO" : "Return IPO for revision",
        samplePreview.kind === "IPO / PT review sample"
          ? "Record this review-only sample decision? This does not issue a live job."
          : "Record Accounts review of this saved IPO?",
        approve ? "Approve IPO" : "Return for revision",
      ))
    )
      return;
    setBusy(true);
    try {
      const sample = samplePreview.kind === "IPO / PT review sample";
      await api(`/ubl-workflow/${samplePreview.request_id}/action`, {
        csrf: session.csrfToken,
        body: {
          version: samplePreview.request_version,
          action: sample
            ? approve
              ? "sample-accept"
              : "sample-return"
            : approve
              ? "accept"
              : "return",
          input: { notes },
        },
      });
      const refreshed = await api<any>("/accounts-workspace");
      setData(refreshed);
      setSamplePreview(
        refreshed.reviewSamples.find(
          (r: any) => r.request_id === samplePreview.request_id,
        ),
      );
      setMessage(
        approve
          ? "Accounts IPO review approved."
          : "IPO returned for revision.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function attachPt(file: File) {
    if (!job || busy) return;
    setErrorAction("pt-upload");
    setError("");
    if (
      !["image/png", "image/jpeg", "application/pdf"].includes(file.type) ||
      file.size > 8388608
    ) {
      setError("Attach a PDF, PNG or JPEG PT report up to 8 MB.");
      return;
    }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Unable to read this file. Choose it again."));
        reader.readAsDataURL(file);
      });
      const result = await api<any>("/accounts-workspace/evidence", {
        csrf: session.csrfToken,
        body: {
          jobKey: job.jobKey,
          filename: file.name,
          mediaType: file.type,
          base64,
        },
      });
      const refreshed = await api<any>(
        "/accounts-workspace/job?key=" + encodeURIComponent(job.jobKey),
      );
      setJob({ ...job, evidence: refreshed.evidence });
      setPtAttachmentId(result.id);
      setMessage(
        "Final PT report attached. Save the draft to include it in the closure.",
      );
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
      !(await confirmAccountsAction(
        "Submit closure to Management",
        "Actual costs and evidence references will be frozen for review. The job closes only after Management approval.",
        "Submit closure to Management",
      ))
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
          ptAttachmentId,
          operationsEvidenceSignature: job.operationsEvidenceSignature??null,
          requestKey: crypto.randomUUID(),
          ...(editingSubmitted?{amendmentReason}:{}),
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
      !(await confirmAccountsAction(
        decision === "Closed"
          ? "Approve job closure"
          : "Return closure for revision",
        decision === "Closed"
          ? "This records Management approval and closes this job."
          : "Accounts will be able to revise its actual-cost entry.",
        decision === "Closed" ? "Approve and close job" : "Return for revision",
      ))
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
      onDecision?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Closed jobs retain their source reports and PT history, but are no longer Accounts work.
  // Match the latest authoritative closure by exact job key, never by site name or shared IPO.
  const closedJobKeys = new Set(data.closures.filter((c:any)=>c.stage==='Closed').map((c:any)=>c.job_key));
  const reports = inventoryReports.filter(r=>!closedJobKeys.has(r.job_key));
  const ptRecorded=(kind:string,r:any)=>(data.ptEntries??[]).find((p:any)=>p.source_kind===kind&&p.source_id===r.id&&p.source_version===(kind==='IPO'?1:r.version));
  const filtered = data.ipos.filter((i: any) =>
    `${i.number} ${i.snapshot.siteName} ${i.snapshot.customer?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const received = reports.filter(
    (r) => !data.closures.some((c: any) => c.job_key === r.job_key),
  );
  const preparationReports=reports.filter(r=>isClosurePreparationJob({latestClosure:data.closures.find((c:any)=>c.job_key===r.job_key),ptRecorded:!!ptRecorded('Inventory',r)}));
  const total = (v: Record<string, string>, keys: string[]) =>
    keys.reduce((n, k) => n.add(v[k] || "0"), new Decimal(0));
  let actualTotal: Decimal | null = null,
    epcTotal = new Decimal(0);
  try {
    epcTotal = new Decimal(epcAggregate || "0");
    if (
      phases.every((k) => actual[k] !== null && actual[k] !== undefined && actual[k] !== "") &&
      epcAggregate !== ""
    )
      actualTotal = total(actual, phases).add(epcTotal);
  } catch {}
  const budgetTotal = job && Object.values(job.budget).every(v => v !== null && v !== undefined && v !== "")
    ? Object.values(job.budget).reduce(
        (n: Decimal, v: any) => n.add(v),
        new Decimal(0),
      )
    : null;
  if(managementReview&&job&&!['Awaiting Management','Closed'].includes(latest?.stage))return <section className="pz-stack"><Button variant="neutral" onClick={onBack}>Back to jobs awaiting closure</Button><p role="status">This closure is no longer awaiting your approval. Current status: {latest?.stage??'Not submitted'}.</p></section>;
  if(managementReview&&!job)return <section className="pz-stack"><Button variant="neutral" onClick={onBack}>Back to jobs awaiting closure</Button>{error?<p role="alert" className="form-error">{error}</p>:<p role="status">Loading the saved Accounts closure…</p>}</section>;
  return (
    <section className="pz-accounts">
      {managementReview && <div className="pz-action-row"><Button variant="neutral" onClick={onBack}>Back to jobs awaiting closure</Button></div>}
      {managementReview && <h2>Review job closure</h2>}
      {!managementReview && <div className="pz-action-row">
        {['Job Closure','Awaiting Management','Closed Jobs'].includes(tab)&&!job&&<Field id="closure-status" label="Job status"><select id="closure-status" value={tab} onChange={e=>navigate(e.target.value)}><option value="Job Closure">Ready / In preparation</option><option>Awaiting Management</option><option value="Closed Jobs">Closed</option></select></Field>}
      </div>}
      {!["My Workspace","Physical Documents","IPOs Received","IPOs Recorded in PT","Approved Documents","Inventory PT Entries","Inventory Recorded in PT","Job Closure","Awaiting Management","Closed Jobs","Project Sites","Programme Dashboard","Project Tracking","Payments to Record","IPO Review","Invoicing","Receivables"].includes(tab)&&<h2>{tab==="My Workspace"?"Work queues":tab}</h2>}
      {doDocument&&<AccountsRecordDialog title="Site documents" reference={doDocument.record.number??jobLabel(doDocument.record)} subtitle={doDocument.record.site_name??doDocument.record.snapshot?.siteName} onClose={()=>{inventoryDocumentRequest.current++;setDoDocument(undefined);}}><section className="accounts-record-section"><h3>{doDocument.record.site_name??doDocument.record.snapshot?.siteName??jobLabel(doDocument.record)}</h3><p>Signed source documents and report attachments for this site only. Reconciliation and PT entry are separate actions.</p></section><section className="accounts-record-section"><h3>Approved documents</h3>{doDocument.loading?<p role="status">Loading site documents…</p>:doDocument.error?<p role="alert" className="form-error">{doDocument.error}</p>:(doDocument.files?.length||doDocument.signedFiles?.length)?<ul className="accounts-file-list">{(doDocument.signedFiles??[]).map((file:any)=><li key={file.id}><span>{file.kind}<small>{file.filename} · {file.source}</small></span><EvidencePreview url={file.downloadUrl} title={file.kind} filename={file.filename}/></li>)}{(doDocument.files??[]).map((file:any)=><li key={file.id}><span>{file.filename}</span><EvidencePreview url={'/api/inventory-reconciliation/files/'+file.id} title={file.filename} filename={file.filename}/></li>)}</ul>:<p>No signed source files or attachments have been uploaded for this site. Its imported reconciliation data is a separate report, not a signed document.</p>}</section></AccountsRecordDialog>}
      {ptDocument&&<AccountsRecordDialog title="Record PT Entry" reference={ptDocument.number??jobLabel(ptDocument)} onClose={()=>void closePtEntry()}><p>Confirm the document has been entered in PT, then save its reference here.</p><div className="pz-form-grid"><Field id="pt-entry-reference" label="PT reference (required)"><input id="pt-entry-reference" value={ptEntryReference} onChange={e=>setPtEntryReference(e.target.value)}/></Field><Field id="pt-entry-date" label="Entry date (required)"><input id="pt-entry-date" type="date" value={ptEntryDate} onChange={e=>setPtEntryDate(e.target.value)}/></Field></div><Field id="pt-entry-notes" label="PT entry notes"><textarea id="pt-entry-notes" value={ptEntryNotes} onChange={e=>setPtEntryNotes(e.target.value)}/></Field><Button variant="primary" loading={busy} onClick={()=>void savePtEntry()}>Save PT entry</Button>{error&&errorAction==='pt-entry'&&<p role="alert" className="form-error">{error}</p>}</AccountsRecordDialog>}
      {["Programme Dashboard","Project Tracking"].includes(tab) && <ProgrammeDashboard userId={session.user.id} title="Project Tracking" endpoint="/accounts-workspace/programmes" onOpenSite={row=>{if(row.recordKey?.startsWith('ipo:'))void openIpo(row.recordKey.slice(4));else{setProgrammeSiteKey(row.sourceKey);navigate('Project Sites');}}}/>}
      {tab === "Project Sites" && <><header className="accounts-panel-heading accounts-subpage-heading"><h2>Site Details</h2><Button variant="neutral" onClick={()=>navigate("Project Tracking")}>Back to Project Tracking</Button></header><AccountsImportedSites initialSiteKey={programmeSiteKey} onOpenIpo={id=>void openIpo(id)}/></>}
      {tab === "Physical Documents" && <AccountsPhysicalDocuments/>}
      {tab === "Approved Documents" && <AccountsCustomerDocuments/>}
      {tab === "Payments to Record" && <><Button variant="neutral" onClick={()=>navigate("My Workspace")}>Back to Dashboard</Button><AccountsPayments/></>}
      {tab === "Project checkpoints" && (
        <ProjectCheckpoints session={session} mode="Accounts" />
      )}
      {error && !errorAction && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data.localSnapshot&&!['Physical Documents','Invoicing'].includes(tab)&&<details className="accounts-data-note"><summary>Local testing copy · {data.ipos.length} received IPOs</summary><p>Saved {data.localSnapshot.sourceSnapshot}. {(data.localSnapshot.limitations??[]).join(' ')} PT and review changes stay in this local copy.</p></details>}
      {tab === "My Workspace" && (
        <>
          <div className="stage-grid workspace-buckets accounts-dashboard-buckets" role="group" aria-label="Project accounting work">
            {[
              ['IPOs Received',data.ipos.filter((i:any)=>!ptRecorded('IPO',i)).length,'IPOs Received',`${data.ipos.filter((i:any)=>ptRecorded('IPO',i)).length} recorded in PT`],
              ['Approved Documents',approvedDocumentCount??'—','Approved Documents','Sites with QC signed documents'],
              ['Inventory Reconciliations',reports.filter(r=>!ptRecorded('Inventory',r)).length,'Inventory PT Entries',`${reports.filter(r=>ptRecorded('Inventory',r)).length} recorded in PT`],
              ['Job Closure',preparationReports.length,'Job Closure','Ready, drafts and returned jobs'],
              ['Awaiting Management',data.closures.filter((c:any)=>c.stage==='Awaiting Management').length,'Awaiting Management',`${data.closures.filter((c:any)=>c.stage==='Closed').length} jobs closed`],
            ].map(([label,count,destination,hint])=><Button key={String(label)} variant="neutral" className="stage-card" onClick={()=>navigate(String(destination))}><strong>{count}</strong><span>{label}</span><small>{hint}</small></Button>)}
          </div>


          <section className="accounts-list-panel accounts-billing-module" aria-labelledby="accounts-billing-module-title">
            <header className="accounts-panel-heading"><div><h2 id="accounts-billing-module-title">Invoicing &amp; Payments</h2><p>Invoice submissions and customer payment records.</p></div></header>
            <div className="stage-grid workspace-buckets accounts-dashboard-buckets accounts-billing-buckets" role="group" aria-label="Invoicing and payments">
              {[
              ['Invoices to Submit',invoiceQueueCount??(queueCountError?'—':'…'),'Invoices to Submit',queueCountError?'Count unavailable · open queue':'Delivery and completion invoices'],
              ['Payments to Record',paymentQueueCount??(queueCountError?'—':'…'),'Payments to Record',queueCountError?'Count unavailable · open queue':'Awaiting payment and receipt details'],
              ].map(([label,count,destination,hint])=><Button key={String(label)} variant="neutral" className="stage-card" onClick={()=>navigate(String(destination))}><strong>{count}</strong><span>{label}</span><small>{hint}</small></Button>)}
            </div>
          </section>

          <section className="accounts-list-panel accounts-next-actions"><header className="accounts-panel-heading"><h2>Next Actions</h2></header>

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
                {data.reviewSamples?.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      {r.site_name} · UBL {r.branch_code} · {r.configuration}
                    </td>
                    <td>
                      {r.kind === "IPO / PT review sample"
                        ? (r.review_decision ??
                          "Sample—awaiting Accounts approval")
                        : r.stage}
                    </td>
                    <td>
                      <Button
                        onClick={() => {
                          setSamplePreview(r);
                          setSelected(undefined);
                          setTab("IPO Review");
      window.scrollTo(0,0);
                        }}
                      >
                        Review IPO &amp; PT
                      </Button>
                    </td>
                  </tr>
                ))}
                {data.ipos
                  .filter((i: any) => !ptRecorded('IPO',i))
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
                    <td>{jobLabel(r)}</td>
                    <td>Inventory approved · awaiting PT entry</td>
                    <td>
                      <Button onClick={() => navigate("Inventory PT Entries")}>
                        Enter approved documents in PT
                      </Button>
                    </td>
                  </tr>
                ))}
                {data.closures
                  .filter((c: any) => c.stage !== "Closed")
                  .map((c: any) => (
                    <tr key={c.id}>
                      <td>{jobLabel(c.snapshot)}</td>
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
          </section>
        </>
      )}
      {['IPOs Received','IPOs Recorded in PT','Inventory PT Entries','Inventory Recorded in PT'].includes(tab)&&(()=>{
        const kind=tab.startsWith('IPO')?'IPO':'Inventory';
        const recorded=tab.endsWith('Recorded in PT');
        const queueRecords=(kind==='IPO'?data.ipos:reports).filter((r:any)=>kind==='IPO'||!inventoryType||(inventoryType==='delivery'?isDeliveryOnlyDo(r):!isDeliveryOnlyDo(r)));
        const rows=queueRecords.filter((r:any)=>!!ptRecorded(kind,r)===recorded).filter((r:any)=>`${r.number??''} ${r.snapshot?.siteName??r.site_name??''} ${r.job_key??''}`.toLowerCase().includes(search.toLowerCase()));
        return <><section className="accounts-list-panel accounts-pt-panel"><header className="accounts-panel-heading"><div><h2>{kind==='IPO'?'IPO Entries':'Inventory Reconciliations · PT Entries'}</h2>{kind==='Inventory'&&<p>Open jobs only. Closed jobs remain in Job Closure → Closed; original documents and PT records are retained.</p>}</div><div className="accounts-queue-switch"><Button variant="neutral" aria-pressed={!recorded} onClick={()=>navigate(kind==='IPO'?'IPOs Received':'Inventory PT Entries')}>Awaiting PT · {queueRecords.filter((r:any)=>!ptRecorded(kind,r)).length}</Button><Button variant="neutral" aria-pressed={recorded} onClick={()=>navigate(kind==='IPO'?'IPOs Recorded in PT':'Inventory Recorded in PT')}>Recorded · {queueRecords.filter((r:any)=>ptRecorded(kind,r)).length}</Button></div></header><div className="accounts-worklist-filters">
<Field id="pt-document-search" label="Search document or site"><input id="pt-document-search" value={search} onChange={e=>setSearch(e.target.value)}/></Field>{kind==='Inventory'&&<Field id="inventory-document-kind" label="Document type"><select id="inventory-document-kind" value={inventoryType??'all'} onChange={e=>setInventoryType(e.target.value==='all'?null:e.target.value)}><option value="all">All documents</option><option value="installation">IRRs &amp; Variable Items</option><option value="delivery">Delivery-only DOs</option></select></Field>}</div><div className="pz-table-scroll"><table className="accounts-entry-table"><thead><tr><th>Site / IPO</th><th>{recorded?'PT Reference':'Received'}</th><th>Action</th></tr></thead><tbody>{rows.map((r:any)=>{const entry=ptRecorded(kind,r);return <tr key={r.id}><td><strong>{r.snapshot?.siteName||r.site_name||jobLabel(r)}</strong><small>{r.number||r.job_id||r.job_key}{kind==='Inventory'?' · '+accountsDocumentLabel(r):''}</small></td><td>{entry?<>{entry.pt_reference}<small>{String(entry.entry_date).slice(0,10)}</small></>:r.received_at||r.created_at?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'}).format(new Date(r.received_at||r.created_at)):'Not recorded'}</td><td><Button variant="neutral" onClick={()=>kind==='IPO'?void openIpo(r.id):void openInventoryDocuments(r)}>View documents</Button>{kind==='Inventory'&&!isDeliveryOnlyDo(r)&&<Button variant="neutral" onClick={()=>{setInventoryReport(r);void navigate('Inventory Reconciliations');}}>View reconciliation</Button>}{!entry&&<Button variant="secondary" onClick={()=>{setPtDocument({...r,kind});setPtEntryReference('');setPtEntryNotes('');setError('');}}>Record PT entry</Button>}{entry&&kind==='Inventory'&&!isDeliveryOnlyDo(r)&&<Button variant="secondary" onClick={()=>void openJob(r.job_key)}>Prepare job closure</Button>}</td></tr>;})}</tbody></table>{rows.length===0&&<p>{kind==='Inventory'&&inventoryType==='delivery'?'No approved delivery-only DOs have been received yet.':'No documents in this bucket.'}</p>}</div></section></>;
      })()}
      {['Awaiting Management','Closed Jobs'].includes(tab)&&<section className="accounts-list-panel accounts-closure-list"><header className="accounts-panel-heading"><h2>{tab}</h2></header><div className="pz-table-scroll"><table><thead><tr><th>Job / site</th><th>Stage</th><th>Action</th></tr></thead><tbody>{data.closures.filter((c:any)=>c.stage===(tab==='Closed Jobs'?'Closed':'Awaiting Management')).map((c:any)=><tr key={c.id}><td>{jobLabel(c.snapshot)}</td><td>{c.stage}</td><td><div className="pz-action-row"><Button variant="secondary" onClick={()=>void openJob(c.job_key)}>View closure</Button>{c.stage==="Awaiting Management"&&!managementReview&&<Button variant="neutral" onClick={()=>void openJob(c.job_key,true)}>Edit</Button>}</div></td></tr>)}</tbody></table>{!data.closures.some((c:any)=>c.stage===(tab==='Closed Jobs'?'Closed':'Awaiting Management'))&&<div className="accounts-empty"><h3>No jobs in this bucket</h3><p>Jobs appear here as they progress through Management review.</p></div>}</div></section>}
      {tab === "IPO Review" && (
        <>
          {!selected&&!samplePreview&&<>
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
                {data.reviewSamples
                  ?.filter((r: any) =>
                    `${r.site_name} ${r.branch_code} ${r.configuration}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        {r.site_name} · UBL {r.branch_code} · {r.configuration}
                      </td>
                      <td>
                        {r.kind === "IPO / PT review sample"
                          ? (r.review_decision ??
                            "Sample—awaiting Accounts approval")
                          : r.stage}
                      </td>
                      <td>
                        <Button
                          onClick={() => {
                            setSamplePreview(r);
                            setSelected(undefined);
                          }}
                        >
                          Review IPO &amp; PT
                        </Button>
                      </td>
                    </tr>
                  ))}
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
                        {i.snapshot.approvedCommercialSource?.type === 'framework' ? 'Compare agreement & IPO' : 'Compare approved quote & IPO'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>}
          {samplePreview && (
            <article className="detail-panel">
              <h3>
                {samplePreview.site_name} · UBL {samplePreview.branch_code} ·{" "}
                {samplePreview.configuration}
              </h3>
              <p>
                {samplePreview.kind === "IPO / PT review sample"
                  ? "Sample—review only. PO not received. Approval records a sample review; no job or material authorization."
                  : "UBL standard configuration sale—review approved pricing, IPO and PT before Accounts acceptance."}
              </p>
              <div className="pz-form-grid">
                <section>
                  <h3>Approved quotation</h3>
                  <p>
                    Not available—UBL standard configuration pricing is used.
                  </p>
                </section>
                <DocumentPreview
                  title="IPO and PT"
                  url={`/api/ubl-workflow/documents/${samplePreview.id}.pdf`}
                />
              </div>
              <Field
                id="ubl-accounts-review-notes"
                label="Accounts review remarks / revision reason"
              >
                <textarea
                  id="ubl-accounts-review-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
              <div className="pz-action-row">
                <Button
                  variant="success"
                  disabled={
                    busy ||
                    (samplePreview.kind === "IPO / PT review sample" && samplePreview.review_decision === "Approved sample") ||
                    samplePreview.stage ===
                      "Accounts Accepted—BOQ Issuance Pending"
                  }
                  onClick={() => void reviewWorkflowIpo(true)}
                >
                  Approve IPO
                </Button>
                <Button
                  variant="warning"
                  disabled={busy}
                  onClick={() => void reviewWorkflowIpo(false)}
                >
                  Return for revision
                </Button>
              </div>
              {samplePreview.review_decision && (
                <p role="status">{samplePreview.review_decision}</p>
              )}
              {error && errorAction === "workflow-ipo" && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </article>
          )}
          {selected && (
            <article className="accounts-ipo-review">
              <header className="accounts-ipo-record-heading"><div><span className="accounts-record-reference">{selected.ipo.number}</span><h2>{selected.ipo.snapshot.siteName}</h2><p>{selected.saleType}{ipoReceivedLabel?` · Received ${ipoReceivedLabel}`:''}</p></div><Button variant="neutral" onClick={()=>navigate("IPOs Received")}>Back to IPOs</Button></header>
              <section className="accounts-ipo-progress" aria-label="IPO review and PT status"><div><span>IPO total · incl. GST</span><strong>{money(selected.ipo.snapshot.allocation.total)}</strong><small>Approved selling value</small></div><div><span>1 · Accounts review</span><strong>{selected.history[0]?.decision??'Awaiting review'}</strong><small>{selected.reconciles?'Matches the approved commercial basis':'Amount comparison requires attention'}</small></div><div><span>2 · PT entry</span><strong>{ptRecorded('IPO',selected.ipo)?.pt_reference||'Not recorded'}</strong><small>{ptRecorded('IPO',selected.ipo)?`Entered ${String(ptRecorded('IPO',selected.ipo).entry_date).slice(0,10)}`:'Enter in PT, then save the PT reference'}</small></div><div className="accounts-ipo-next-action">{selected.history[0]?.decision!=='Verified'?<Button variant="primary" onClick={()=>{document.getElementById('accounts-review-actions')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});document.getElementById('accounts-note')?.focus({preventScroll:true});}}>Go to decision</Button>:!ptRecorded('IPO',selected.ipo)&&<Button variant={selected.history[0]?.decision==='Verified'?'primary':'secondary'} onClick={()=>{setPtDocument({...selected.ipo,kind:'IPO'});setPtEntryReference('');setPtEntryNotes('');setError('');}}>Record PT entry</Button>}</div></section>
              <div className="accounts-ipo-columns"><section className="accounts-list-panel accounts-ipo-phases">
              <header className="accounts-panel-heading"><h3>PT selling breakup</h3><span>PKR · excluding GST</span></header>
              <div className="table-scroll">
                <table className="accounts-ipo-phase-table"><thead><tr><th scope="col">PT phase</th><th scope="col" className="pz-number">Amount</th></tr></thead>
                  <tbody>
                    {selected.ipo.snapshot.peachtree?.phases
                      .filter((p: any) => p.name !== "EPC")
                      .map((p: any, i: number) => (
                        <tr key={i}>
                          <th scope="row">{p.name}<small className="muted" style={{display:"block",fontWeight:"normal"}}>{ptQuantityDescription(p.description)}</small></th>
                          <td className="pz-number">{money(p.amount)}</td>
                        </tr>
                      ))}
                    <tr>
                      <th scope="row">BESS subtotal<small>Inverter, batteries &amp; BMS · included above</small></th>
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
                      .flatMap((p: any) => [
                        <tr key="epc-total" className="accounts-epc-total">
                          <th scope="row">EPC total<small>{selected.ipo.snapshot.peachtree?.epcBreakup?.length ? 'Breakdown included below' : 'Detailed breakdown not recorded in this IPO'}</small></th>
                          <td className="pz-number">{money(p.amount)}</td>
                        </tr>,
                        ...(selected.ipo.snapshot.peachtree?.epcBreakup ?? []).map((part: any, index: number) => (
                          <tr key={'epc-part-'+index} className="accounts-epc-part">
                            <th scope="row">{part.name}<small>{ptQuantityDescription(part.description)}</small></th>
                            <td className="pz-number">{money(part.amount)}</td>
                          </tr>
                        )),
                      ])}

                  </tbody>
                </table>
              </div>
              </section><section className="accounts-ipo-source-preview">
                <DocumentPreview
                  compactControls
                  title={"IPO and PT " + selected.ipo.number}
                  url={"/api/orders/" + selected.ipo.id + "/ipo.pdf"}
                />
              </section></div>
              <section id="accounts-review-actions" className="accounts-list-panel accounts-ipo-review-actions"><header className="accounts-panel-heading"><h3>Accounts decision</h3><span>{selected.history[0]?.decision??'Awaiting review'}</span></header>
              {selected.history[0]?.decision !== "Verified" && (
                <>
                  <Field
                    id="accounts-note"
                    label="Review note / revision reason (required)"
                    hint="Add a note to enable the decision buttons. Verification records the Accounts review; PT entry is recorded separately."
                  >
                    <textarea
                      id="accounts-note"
                      required
                      aria-describedby="accounts-note-hint"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </Field>
                  <div className="pz-action-row accounts-ipo-decision-buttons">
                    <Button
                      variant="warning"
                      disabled={busy || !notes.trim()}
                      onClick={() => void review("Returned for Revision")}
                    >
                      Return for revision
                    </Button>
                    <Button
                      variant="success"
                      loading={busy}
                      disabled={busy || !notes.trim() || !selected.reconciles}
                      onClick={() => void review("Verified")}
                    >
                      Verify IPO
                    </Button>
                  </div>
                  {!selected.reconciles && <p className="accounts-panel-help">Verification is unavailable until the IPO matches the approved commercial basis. You can return it with a revision reason.</p>}
                </>
              )}
              {error && errorAction === "ipo" && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              {selected.history[0]?.decision==='Verified'&&<p className="accounts-panel-help">IPO verified. {ptRecorded('IPO',selected.ipo)?'The PT reference has also been recorded.':'Next, enter the IPO in PT and record its reference using the action above.'}</p>}</section>
              <section className="accounts-list-panel accounts-ipo-support"><h3>Supporting details</h3><details><summary>Approved commercial basis</summary>
              <div className="pz-form-grid">
                {selected.agreement ? (
                  <section className="pz-panel pz-stack">
                    <h3>Approved agreement · {selected.agreement.number} v{selected.agreement.version}</h3>
                    <p>{selected.agreement.reference || "Reference not entered"}</p>
                    <p>Agreed payable including GST: {money(selected.agreement.total)}</p>
                    {selected.agreement.terms && <dl>{Object.entries(selected.agreement.terms).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}
                  </section>
                ) : selected.quotation?.id ? (
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
              </div>
              </details>
              <details>
                <summary>Selling amount comparison</summary>
                <div className="pz-form-grid">
                  <section>
                    <h3>{selected.agreement ? "Approved agreement · " + selected.agreement.number : "Approved quotation · " + (selected.quotation?.number ?? "Not available")}</h3>

                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.agreement?.lines.map((line:any,index:number)=><tr key={"agreement-"+index}><td>{line.description}</td><td className="pz-number">{money(line.amount)}</td></tr>)}
                          {selected.agreement && <tr><th>Agreed payable including GST</th><td className="pz-number">{money(selected.agreement.total)}</td></tr>}
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
              <details><summary>Discount allocation</summary>
              <h3>Discount allocation summary</h3>
              <p>
                {selected.agreement ? "Allocation is preserved from the approved agreement." : "Solar has zero discount. Allocation is preserved from the accepted quotation."}
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
              </details>
              <details>
                <summary>Accounts review history</summary>
                {selected.history.map((h: any) => (
                  <p key={h.id}>
                    {h.decision} · {h.recorded_by} · {h.notes}
                  </p>
                ))}
              </details>
              </section>
            </article>
          )}
          {!selected&&!samplePreview&&<details className="accounts-data-note"><summary>Existing Accounts preparation records</summary><Button onClick={() => setLegacy(!legacy)}>Open preparation records</Button>{legacy && <Departments session={session} department="Accounts" />}</details>}
        </>
      )}
      {tab === "Inventory Reconciliations" && (
        <><Button variant="neutral" onClick={()=>{setInventoryReport(undefined);void navigate('Inventory PT Entries');}}>Back to Inventory PT entries</Button><InventoryWorkspace session={session} accounts initialJobKey={inventoryReport?.job_key}/></>
      )}
      {tab === "Job Closure" && !job && (
        <section className="accounts-list-panel accounts-closure-list">
          <header className="accounts-panel-heading"><h2>Ready for Job Closure</h2><span>{preparationReports.length} jobs</span></header>
          <p className="accounts-panel-help">Record the final PT report and actual costs, then send for Management review.</p>
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
                {preparationReports.map((r) => (
                  <tr key={r.id}>
                    <td>{jobLabel(r)}</td>
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
          {!preparationReports.length&&<div className="accounts-empty"><h3>No jobs ready for closure</h3><p>Approved Inventory documents will appear here after their PT entry is recorded.</p></div>}
        </section>
      )}
      {tab === "Job Closure" && job && (
        <article className="detail-panel accounts-closure-form">
          <header className="accounts-panel-heading"><h3>{jobLabel(job)}</h3><div className="pz-action-row">{latest?.stage==="Awaiting Management"&&!managementReview&&!editingSubmitted&&<Button variant="secondary" disabled={busy} onClick={()=>setEditingSubmitted(true)}>Edit submitted closure</Button>}<Button variant="neutral" onClick={()=>navigate("Job Closure")}>Back to jobs</Button></div></header>{editingSubmitted&&<p className="pz-caption">Edit costs and remarks, then save a new version for Management review. The submitted version and signed evidence remain in history.</p>}
          <p>
            {latest?.stage ?? "New closure"} · {job.basis}
            {latest && <> · Recorded by {latest.recorded_by}</>}
          </p>
          {revisionReason && (
            <div className="accounts-verification-note" role="status">
              <strong>Management requested revision</strong>
              <p style={{whiteSpace:"pre-wrap"}}>{revisionReason}</p>
            </div>
          )}
          <p>
            Installation: {job.entry.start} → {job.entry.end} · Net days:{" "}
            {installationDays(job.entry) ?? "Not available"} (inclusive)
          </p>
          {manager && <ClosureComparison job={job} actual={actual} epcAggregate={epcAggregate} epc={epc}/>}
          {latest?.snapshot.amendment?.reason&&<p className="pz-caption">Latest correction: {latest.snapshot.amendment.reason}</p>}
          {(!manager||!readonly)&&<details open={!readonly}><summary>Costing breakdown and EPC details</summary>
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
          </details>}
          {!manager && <>
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
                  <td className="pz-number">{budgetTotal ? money(budgetTotal.toString()) : "Not available"}</td>
                  <td className="pz-number">
                    {money(actualTotal?.toString())}
                  </td>
                </tr>
                <tr>
                  <th>Markup amount</th>
                  <td className="pz-number">
                    {budgetTotal && job.selling != null ? money(
                      new Decimal(job.selling).sub(budgetTotal).toString(),
                    ) : "Not available"}
                  </td>
                  <td className="pz-number">
                    {actualTotal && job.selling != null
                      ? money(
                          new Decimal(job.selling).sub(actualTotal).toString(),
                        )
                      : "Not entered"}
                  </td>
                </tr>
                <tr>
                  <th>Markup % on cost</th>
                  <td className="pz-number">
                    {!budgetTotal || budgetTotal.isZero() || job.selling == null
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
                    {!actualTotal || actualTotal.isZero() || job.selling == null
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
          </>}
          {actualTotal && (
            <section>
              <h3>Potential cable invoice adjustment impact · excluding GST</h3>
              <p>
                Scenario only, pending authorized invoice adjustment. This does
                not post an invoice or change the approved selling price.
              </p>
              <table>
                <tbody>
                  <tr>
                    <th>Cable adjustment only</th>
                    <td className="pz-number">
                      {money(cableInvoiceAdjustment(job.reconciliation).net)}
                    </td>
                  </tr>
                  <tr>
                    <th>Selling price after potential adjustment</th>
                    <td className="pz-number">
                      {money(
                        new Decimal(job.selling)
                          .add(
                            cableInvoiceAdjustment(job.reconciliation).net ??
                              "0",
                          )
                          .toString(),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th>Actual markup after potential adjustment</th>
                    <td className="pz-number">
                      {money(
                        new Decimal(job.selling)
                          .add(
                            cableInvoiceAdjustment(job.reconciliation).net ??
                              "0",
                          )
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
                              .add(
                                cableInvoiceAdjustment(job.reconciliation)
                                  .net ?? "0",
                              )
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
          <p>
            Per-watt and other non-cable quantity differences remain cost/usage
            variances. Good-faith supply does not adjust the invoice.
          </p>
          <h3>Cable invoice reconciliation</h3>
          <p>
            Potential adjustment without GST:{" "}
            {money(cableInvoiceAdjustment(job.reconciliation).net)} · With GST:{" "}
            {money(cableInvoiceAdjustment(job.reconciliation).gross)}
          </p>
          <p>
            This does not change approved selling values. Invoicing and
            authorized adjustment posting are deferred.
          </p>
          <section className="detail-panel">
            <h3>QC supporting documents</h3>
            <p>
              Uploaded by QC. Accounts reviews receipt status and does not enter
              these references.
            </p>
            {["Client acknowledgment", "Site photographs", ...(job.evidence?.some((e:any)=>e.source?.kind==='Operations')?["IRR", "Variable items sign-off"]:[])].map((kind) => {
              const files =
                job.evidence?.filter((e: any) => e.kind === kind) ?? [];
              return (
                <p key={kind}>
                  <strong>{kind}:</strong>{" "}
                  {files.length ? "Received" : "Not received"}{" "}
                  {files.map((e: any) => (
                    <a
                      key={e.id}
                      href={e.downloadUrl??`/api/accounts-workspace/evidence/${e.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.filename}
                    </a>
                  ))}
                </p>
              );
            })}
          </section>
          <section className="detail-panel">
            <h3>Final PT report · actual costs by PT phase</h3>
            {job.evidence
              ?.filter((e: any) => e.kind === "PT costing screenshot")
              .map((e: any) => (
                <p key={e.id}>
                  <a
                    href={e.downloadUrl??`/api/accounts-workspace/evidence/${e.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {e.filename}
                  </a>
                  {e.id === ptAttachmentId
                    ? " · Selected for this closure"
                    : !readonly && !editingSubmitted && (
                        <Button onClick={() => setPtAttachmentId(e.id)}>
                          Use this PT report
                        </Button>
                      )}
                </p>
              ))}
            {!readonly && !editingSubmitted && (
              <Field
                id="closure-pt-upload"
                label="Attach final PT report"
                hint="PDF, PNG or JPEG · up to 8 MB"
              >
                <FileUpload attachments={(job.evidence??[]).filter((f:any)=>f.id===ptAttachmentId)} onRemoveAttachment={()=>setPtAttachmentId(null)} onClear={()=>setPtAttachmentId(null)}
                  id="closure-pt-upload"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.files?.[0]) void attachPt(e.target.files[0]);
                  }}
                />
                {error && errorAction === "pt-upload" && (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                )}
              </Field>
            )}
            {readonly && !ptAttachmentId && (
              <p>Not attached{pt ? " · Historical reference: " + pt : ""}</p>
            )}
          </section>
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
          {editingSubmitted&&<Field id="closure-amendment-reason" label="Reason for correction"><textarea id="closure-amendment-reason" value={amendmentReason} onChange={e=>setAmendmentReason(e.target.value)}/></Field>}
          {!readonly && (
            <div className="pz-action-row">
              {!editingSubmitted&&<Button
                variant="secondary"
                loading={busy}
                onClick={() => void save("Draft")}
              >
                Save closure draft
              </Button>}
              <Button
                variant="primary"
                disabled={busy||editingSubmitted&&amendmentReason.trim().length<3}
                onClick={() => void save("Awaiting Management")}
              >
                {editingSubmitted?"Save changes for Management review":"Submit closure to Management"}
              </Button>
              {editingSubmitted&&<Button variant="neutral" disabled={busy} onClick={()=>void openJob(job.jobKey)}>Cancel editing</Button>}
            </div>
          )}
          {error && errorAction === "closure" && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {manager && !editingSubmitted && latest?.stage === "Awaiting Management" && (
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
            {job.history.map((h: any) => {
              const decisionNote = closureDecisionNote(h.snapshot);
              return <div key={h.id}>
                <p>
                  V{h.version} · {h.stage} · {h.recorded_by} ·{" "}
                  {new Date(h.created_at).toLocaleString("en-PK", {
                    timeZone: "Asia/Karachi",
                  })}
                </p>
                {decisionNote && <p style={{whiteSpace:"pre-wrap"}}><strong>Decision note:</strong> {decisionNote}</p>}
              </div>;
            })}
          </details>
        </article>
      )}
      {["Invoicing","Invoices to Submit"].includes(tab) && <><Button variant="neutral" onClick={()=>navigate("My Workspace")}>Back to Dashboard</Button><AccountsBilling mode="invoicing"/></>}

    </section>
  );
}
