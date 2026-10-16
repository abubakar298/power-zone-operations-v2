import {FileUpload} from '../ui/FileUpload.js';
import {DirectPoDetailsFields} from './DirectPoDetailsFields.js';
import {directPoCapacityIssues,directPoSuggestions,directPoFields} from '../../shared/direct-po-reading.js';
import { useEffect, useRef, useState } from "react";
import { Decimal } from "decimal.js";
import { api } from "../api.js";
import { Button } from "../ui/Button.js";
import { Icon } from "./Icon.js";
import { DocumentPreview } from "./DocumentPreview.js";
import { saleConfirmationFields } from "../pages/Orders.js";
import { extractText } from "../ocr.js";
import { poSuggestions, ublPoSuggestions, upsPoCapacities } from "../../server/orders/po-extraction.js";
import { confirmTransition } from "../confirm.js";
import { money } from "../numbers.js";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
const customerFields = [
  "contactPerson",
  "designation",
  "phone",
  "email",
  "billingAddress",
];
function amount(text: string, kind: string) {
  const regex =
    kind === "total"
      ? /(?:grand total|total amount|order value|total including (?:GST|tax))\s*(?:\([^)]*\))?\s*[:=]?\s*(?:PKR|Rs\.?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi
      : /(?:total (?:GST|sales tax)|sales tax|GST amount)\s*(?:\([^)]*\))?\s*[:=]?\s*(?:PKR|Rs\.?)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi;
  const values = [
    ...new Set([...text.matchAll(regex)].map((m) => m[1].replace(/,/g, ""))),
  ];
  return values.length === 1 ? values[0] : "";
}
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(
    new Date(),
  );
export function ConfirmSaleForm({ session, detail, action, onBack, initialDirectPo }: any) {
  const r = detail.record,
    c = detail.masterReview.customer,
    framework = r.route.endsWith("framework");
  const directUps = r.route==='direct-framework' && ['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'].includes(detail.basis?.source?.key);
  const savedDirectPo=r.data?.directPoDetails;
  const reviewingDirectPo = directUps && !!(initialDirectPo?.reviewIpo || savedDirectPo);
  const draftValues=savedDirectPo?.values??initialDirectPo?.values??{};
  const [editingRecord,setEditingRecord]=useState(false),[recordValues,setRecordValues]=useState<Record<string,string>>({});
  const attachedDirectPo=initialDirectPo?.document??detail.files?.find((f:any)=>f.id===savedDirectPo?.evidenceId);
  const preAgreedBank = framework && (String(r.customerCode??c.short_code).toUpperCase()==='UBL'||directUps);
  const [ipoError,setIpoError]=useState(''),[ipoCheck,setIpoCheck]=useState('');
  const preAgreedUbl = framework && String(r.customerCode ?? c.short_code).toUpperCase() === "UBL";
  const [input, setInput] = useState<Record<string, string>>({
      evidenceType: initialDirectPo?.evidenceType??savedDirectPo?.evidenceType??"",
      orderDate: draftValues.approvalDate||initialDirectPo?.amounts.orderDate||today(),
      invoiceCompany: "PZES (PVT Ltd)",
      salesPerson: preAgreedBank ? "Waqas ul Haq" : "Atif",
      contactPerson: draftValues.contactPerson??c.contact_person ?? "",
      phone: draftValues.phone??c.phone ?? "",
      email: draftValues.email??c.email ?? "",
      billingAddress: draftValues.billingAddress??c.address ?? "",
      paymentContact: draftValues.paymentContact??c.contact_person ?? "",
      paymentPhone: draftValues.paymentPhone??c.phone ?? "",
      evidenceNotes: [draftValues.approvalSubject,draftValues.approvalContact,draftValues.approvalEmail].filter(Boolean).join(" · "),
      ipoNumber:draftValues.ipoNumber??"",
      orderNumber:draftValues.orderNumber??"",
      poNumber: initialDirectPo?.amounts.poNumber??"",
      customerNtn:c.ntn??"",
      customerStrn:c.strn??"",
    }),
    [basis, setBasis] = useState<any>(),
    [basisError, setBasisError] = useState(""),
    [document, setDocument] = useState<any>(attachedDirectPo),
    [text, setText] = useState(initialDirectPo?.text??savedDirectPo?.sourceText??""),
    [poTotal, setPoTotal] = useState(initialDirectPo?.amounts.total??""),
    [poTax, setPoTax] = useState(initialDirectPo?.amounts.printedTax??""),
    [poPrintedTax,setPoPrintedTax]=useState(initialDirectPo?.amounts.printedTax??""),
    [poInclusive,setPoInclusive]=useState(initialDirectPo?.amounts.taxInclusive??false),
    [scope, setScope] = useState(false),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [salePreview, setSalePreview] = useState<{
      key: string;
      ipo: Blob;
      pt: Blob;
    }>(),
    [previewReviewed, setPreviewReviewed] = useState(false);
  const automaticPreview = useRef(false);
  useUnsavedChanges(!!document);
  useEffect(() => {
    let active = true;
    setBasis(undefined);
    setBasisError("");
    void api<any>(`/project-workflow/${r.id}/preview`, {
      csrf: session.csrfToken,
      body: framework
        ? { kind: "framework", frameworkId: r.frameworkId }
        : { kind: "quotation", quotationId: r.quotation?.id },
    })
      .then((value) => {
        if (active) {
          setBasis(value);
          if(initialDirectPo?.amounts.taxInclusive&&Number(initialDirectPo.amounts.printedTax)===0)setPoTax(String(value.comparison.tax));
          setInput((old) => ({
            ...old,
            invoiceCompany:
              value.comparison.invoiceCompany ?? old.invoiceCompany,
          }));
        }
      })
      .catch((e) => {
        if (active) setBasisError(e.message);
      });
    if (!framework && r.quotation?.id)
      void api<any>(`/orders/quotation-defaults/${r.quotation.id}`)
        .then((value) => {
          if (active)
            setInput((old) => ({
              ...old,
              ...Object.fromEntries(
                Object.entries(value)
                  .filter(
                    ([key, value]) =>
                      key !== "customerName" &&
                      key !== "quotationType" &&
                      typeof value === "string",
                  )
                  .map(([key, value]) => [key, String(value)]),
              ),
            }));
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [r.id]);
  const change = (field: string, value: string) => {
    setInput((old) => ({ ...old, [field]: value }));
    setError("");
  };
  const po = input.evidenceType === "Customer PO";
  const issues: string[] = directUps?directPoCapacityIssues(text,detail.basis?.source?.key??""):[];
  if (po && document) {
    if ((!preAgreedBank || poTotal) && !/^\d+(\.\d+)?$/.test(poTotal))
      issues.push("PO total amount is missing or unreadable");
    else if (poTotal && basis && !new Decimal(poTotal).eq(basis.comparison.total))
      issues.push(
        `Amount differs: approved PKR ${money(basis.comparison.total)}, PO PKR ${money(poTotal)}`,
      );
    if ((!preAgreedBank || poTax) && !/^\d+(\.\d+)?$/.test(poTax))
      issues.push("PO sales tax is missing or unreadable");
    else if (poTax && basis && !(preAgreedBank && new Decimal(poTax).isZero()) && !new Decimal(poTax).eq(basis.comparison.tax))
      issues.push(
        `Sales tax differs: approved PKR ${money(basis.comparison.tax)}, PO PKR ${money(poTax)}`,
      );
    const solar = text.match(
        /(?:solar (?:size|capacity)|system size|PV (?:size|capacity))\s*(?:\(kW\))?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
      )?.[1],
      expected = basis?.source.key?.match(/(\d+)-\d+-\d+/)?.[1];
    if (framework && solar && expected && Number(solar) !== Number(expected))
      issues.push(
        `Configuration differs: approved ${expected} kW solar, PO ${solar} kW`,
      );
    if(directUps){const received=upsPoCapacities(text),expected=detail.basis.source.key.match(/UPS-(\d+)-(\d+)$/);if(received.inverterKw&&expected&&!new Decimal(received.inverterKw).eq(expected[1]))issues.push(`Inverter differs: approved ${expected[1]} kW, PO ${received.inverterKw} kW`);if(received.batteryKwh&&expected&&!new Decimal(received.batteryKwh).eq(expected[2]))issues.push(`Battery differs: approved ${expected[2]} kWh, PO ${received.batteryKwh} kWh`);}
    if (!scope && !preAgreedBank)
      issues.push("PO scope, quantities and terms require confirmation");
  }
  const confirmationRequirements = [
    ...(!basis ? [basisError ? `Unable to load approved quotation: ${basisError}` : "Loading approved quotation details…"] : []),
    ...(!input.evidenceType ? ["Select the sale confirmation type."] : []),
    ...(!document ? ["Upload the approval evidence attachment."] : []),
    ...(!input.orderDate ? ["Enter the Order Date."] : []),
    ...(po && !input.poNumber ? ["Enter the Customer PO reference."] : []),
    ...issues,

  ];
  function renderField([field, label]: any) {
    if (field === 'ipoNumber' || (
      ["customerNtn", "customerStrn"].includes(field) && (!po || !document)
    ))
      return null;
    return (
      <label key={field}>
        {label}
        {field === "salesSource" ? (
          <select
            value={input[field] ?? ""}
            onChange={(e) => change(field, e.target.value)}
          >
            <option value="">Select sales source</option>
            {[
              "Sales team",
              "Director referral",
              "Existing customer",
              "Customer referral",
              "Website / online inquiry",
              "Walk-in",
              "Other",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        ) : (
          <input
            type={
              field === "orderDate"
                ? "date"
                : field === "email"
                  ? "email"
                  : "text"
            }
            required={
              [
                "orderDate",
                "invoiceCompany",
                "salesPerson",
                "evidenceNotes",
              ].includes(field) ||
              (field === "poNumber" && po)
            }
            placeholder={field === "poNumber" ? "N/A if no formal PO was issued" : undefined}
            value={input[field] ?? ""}
            readOnly={field==="salesPerson"&&preAgreedBank}
            maxLength={
              field === "remarks" || field === "evidenceNotes"
                ? 2000
                : field === "billingAddress"
                  ? 1000
                  : 300
            }
            onChange={(e) => change(field, e.target.value)}
          />
        )}
        {field === "invoiceCompany" && (
          <small>
            PZES or PZES (PVT Ltd) for tax deals; Energy Solutions for cash
            deals.
          </small>
        )}
      </label>
    );
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setScope(false);
    try {
      if (file.size > 8388608) throw Error("Use an attachment up to 8 MB.");
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const saved = await api<any>(`/project-workflow/${r.id}/files`, {
        csrf: session.csrfToken,
        body: {
          kind: "PO / confirmation",
          filename: file.name,
          mime: file.type,
          base64,
        },
      });
      setDocument({ ...saved, filename: file.name, mime: file.type });
      if (po || input.evidenceType==="Email approval") {
        setProgress("Reading uploaded PO…");
        const read = await extractText(file, setProgress,false,input.evidenceType==="Email approval"?25:5);
        setText(read.text);
        if(!po){const suggested=directPoSuggestions(read.text,c);if(suggested.approvalDate)setInput(old=>({...old,orderDate:suggested.approvalDate}));return;}
        setInput((old) => ({
          ...old,
          ...Object.fromEntries(
            Object.entries(poSuggestions(read.text))
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, String(value)]),
          ),
        }));
        const ubl=preAgreedBank?ublPoSuggestions(read.text):undefined;
        if(ubl?.poNumber||ubl?.orderDate)setInput(old=>({...old,...(ubl.poNumber?{poNumber:ubl.poNumber}:{}),...(ubl.orderDate?{orderDate:ubl.orderDate}:{})}));
        setPoTotal(ubl?.total||amount(read.text, "total"));
        setPoPrintedTax(ubl?.printedTax??"");setPoInclusive(ubl?.taxInclusive??false);
        setPoTax(ubl?.taxInclusive&&ubl.printedTax&&Number(ubl.printedTax)===0&&basis?String(basis.comparison.tax):ubl?.printedTax||amount(read.text, "tax"));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  const previewKey = JSON.stringify({
    input,
    documentId: document?.id,
    basis: basis?.fingerprint,
    scope,
    poTotal,
    poTax,
  });
  const currentPreview =
    salePreview?.key === previewKey ? salePreview : undefined;
  function receiptPayload() {
    return {
      ...(input.ipoNumber?.trim()?{ipoNumber:input.ipoNumber.trim()}:{}),
      reference: po && input.poNumber.trim() && !/^n\/?a$/i.test(input.poNumber.trim()) ? input.poNumber.trim() : `${input.evidenceType==="Email approval"?"EMAIL":"WA"}-${r.siteCode}-${input.orderDate}-${r.id.slice(0,8)}`,
      date: input.orderDate,
      evidenceId: document.id,
      basisType: framework ? "framework" : "quotation",
      frameworkId: framework ? basis.source.id : undefined,
      quotationId: !framework ? basis.source.id : undefined,
      confirmationType: input.evidenceType,
      saleDetails: {...input,...(preAgreedBank?{poRecordedTotal:poTotal,poRecordedTax:poTax,poAmountSource:poTotal?"Customer PO reading; compared against accepted agreement":"Accepted agreement; PO amount unreadable or redacted",poPrintedTax,poTaxTreatment:poInclusive?"Tax-inclusive payable; approved GST allocation retained":"As printed"}:{})},
      actual: po ? structuredClone(basis.comparison) : undefined,
      reviewed: true,
      customerNtn: input.customerNtn ?? "",
      customerStrn: input.customerStrn ?? "",
      notes: input.evidenceNotes,
    };
  }
  function validation(forPreview = false) {
    return [
      ...confirmationRequirements,
      ...(!forPreview && !accepted ? ["Confirm the customer approved the selected document."] : []),
      ...(editingRecord?["Save or cancel the record corrections before previewing or confirming sale."]:[]),
      ...(ipoError?[ipoError]:[]),
      ...(!input.invoiceCompany.trim() ? ["Enter the invoice company."] : []),
      ...(!input.salesPerson.trim() ? ["Enter the sales person."] : []),
      ...(!input.evidenceNotes.trim()
        ? ["Enter the approval evidence details."]
        : []),
    ];
  }
  async function previewDocuments() {
    const missing = validation(true);
    if (missing.length) {
      setError(missing.join(" "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ ipo: string; pt: string }>(
        `/project-workflow/${r.id}/sale-preview`,
        { csrf: session.csrfToken, body: receiptPayload() },
      );
      const blob = (value: string) =>
        new Blob([Uint8Array.from(atob(value), (c) => c.charCodeAt(0))], {
          type: "application/pdf",
        });
      setSalePreview({
        key: previewKey,
        ipo: blob(result.ipo),
        pt: blob(result.pt),
      });
      setPreviewReviewed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!reviewingDirectPo || !basis || !document || automaticPreview.current) return;
    automaticPreview.current = true;
    void previewDocuments();
  }, [reviewingDirectPo, basis, document]);
  const previewPanel = currentPreview && <section className="pz-stack" aria-label="IPO review">
    <p className="form-note pz-document-review-note">Draft for Accounts review. Sale has not been confirmed; no IPO has been issued or sent.</p>
    <details open className="pz-document-review"><summary><span>Open IPO Preview</span><Icon name="chevron"/></summary><DocumentPreview url="" data={currentPreview.ipo} title="Draft IPO"/></details>
    <details className="pz-document-review"><summary><span>Open PT Breakup Preview</span><Icon name="chevron"/></summary><DocumentPreview url="" data={currentPreview.pt} title="Draft PT Breakup"/></details>
    <label className="pz-review-check"><input type="checkbox" checked={previewReviewed} onChange={e=>setPreviewReviewed(e.target.checked)}/>I reviewed the IPO and PT breakup for Accounts.</label>
  </section>;
  async function submit(e: any) {
    e.preventDefault();
    const missing = [
      ...validation(),
      ...(!currentPreview || !previewReviewed
        ? ["Preview and review the IPO and PT breakup before confirming sale."]
        : []),
    ];
    if (missing.length) {
      setError(missing.join(" "));
      return;
    }
    if (
      !confirmTransition(
        "Confirm sale and issue",
        "IPO and PT breakup will be shared with Accounts; final BOQ will be shared with Operations. This records approval of the exact approved commercial basis.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await action("receipt", receiptPayload());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function clearEvidence(){setDocument(undefined);setText('');setPoTotal('');setPoTax('');setPoPrintedTax('');setPoInclusive(false);setScope(false);setAccepted(false);setSalePreview(undefined);setPreviewReviewed(false);setError('');}
  const evidenceUpload = <label>{po ? "Upload PO" : input.evidenceType==="Email approval" ? "Upload email evidence" : "Upload approval evidence"}
    <FileUpload key={input.evidenceType} disabled={busy||!input.evidenceType} attachments={document?[{...document,url:`/api/project-workflow/${r.id}/files/${document.id}`}]:undefined} onRemoveAttachment={clearEvidence} onClear={clearEvidence} accept="application/pdf,image/png,image/jpeg" onChange={e=>void upload(e.target.files?.[0])}/>
    <small>PDF, PNG or JPEG · up to 8 MB</small>
  </label>;
  return (
    <div className="pz-stack orders-module">
      <div>
        <Button variant="neutral" onClick={onBack}>
          Back to PO Receipt
        </Button>
      </div>
      <section className="pz-panel">
        <h2>{reviewingDirectPo ? "Review IPO" : "Confirm Sale"}</h2>
        {reviewingDirectPo && <>
          {busy && !currentPreview && <p role="status">Preparing draft IPO and PT preview…</p>}
          {previewPanel}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>}
        {savedDirectPo&&!reviewingDirectPo&&<section className="pz-form-section pz-stack">
          <div><Button variant="neutral" onClick={()=>{setRecordValues({...savedDirectPo.values,...Object.fromEntries(directPoFields.filter(([key])=>key in input).map(([key])=>[key,input[key]])),approvalDate:input.orderDate});setEditingRecord(!editingRecord);setError('');}}>{editingRecord?'Cancel editing record':'Edit record'}</Button></div>
          {editingRecord&&<><DirectPoDetailsFields prefix="edit-direct-po" values={recordValues} disabled={busy} onChange={(key,value)=>setRecordValues(old=>({...old,[key]:value}))}/><div><Button variant="primary" loading={busy} onClick={async()=>{setBusy(true);setError('');try{await action('save-direct-po-details',{evidenceId:document.id,evidenceType:input.evidenceType,extracted:savedDirectPo.extracted,sourceText:text,values:recordValues,notes:'Atif corrected the saved Direct PO evidence details.'});setInput(old=>({...old,...Object.fromEntries(directPoFields.filter(([key])=>key in old).map(([key])=>[key,recordValues[key]])),orderDate:recordValues.approvalDate}));setEditingRecord(false);setPreviewReviewed(false);setIpoError("");setIpoCheck("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Save corrections</Button></div>{error&&<p role="alert" className="form-error">{error}</p>}</>}
        </section>}
        <form onSubmit={submit} noValidate>
          {!reviewingDirectPo && <>
          <fieldset disabled={busy} className="order-fields">
            <label>
              {directUps ? "Accepted quotation" : "Accepted quotation / UBL survey"}
              <input
                readOnly
                value={
                  (directUps?basis?.source.key?.replace("-UPS-"," (")+")":basis?.source.key) ??
                  `${r.customerCode} · ${r.site} (${r.siteCode})`
                }
              />
              <small>
                Fixed to the selected customer’s current approved document.
              </small>
            </label>
            <label>
              {directUps ? "Approval evidence" : "Sale confirmation type"}
              <select
                required
                value={input.evidenceType}
                onChange={(e) => {
                  change("evidenceType", e.target.value);
                  setInput((old) => ({
                    ...old,
                    poNumber: "",
                    customerNtn: directUps ? (c.ntn??"") : "",
                    customerStrn: directUps ? (c.strn??"") : "",
                    orderDate: e.target.value === "Customer PO" ? "" : today(),
                  }));
                  setDocument(undefined);
                  setText("");
                  setPoTotal("");
                  setPoTax("");
                  setPoPrintedTax("");setPoInclusive(false);
                  setAccepted(false);
                  setScope(false);
                }}
              >
                <option value="">Select evidence type</option>
                <option>Customer PO</option>
                <option>WhatsApp approval</option>
                {directUps&&detail.basis?.source?.key?.startsWith("MBL-UPS-")&&<option>Email approval</option>}
              </select>
            </label>
            {directUps && <div className="pz-field-wide">{evidenceUpload}</div>}
          </fieldset>
          <h3>PO details, please verify</h3>
          <fieldset disabled={busy} className="order-fields">
            {directUps&&<label>Order number (unit / total)<input value={input.orderNumber??''} placeholder="For example 20/60" onChange={e=>change('orderNumber',e.target.value)}/><small>Unit sequence within the customer's order; separate from its PO reference.</small></label>}
            {<label>IPO Number (optional)
              <input value={input.ipoNumber??''} maxLength={100} placeholder="Automatic numbering if blank" onChange={e=>{change('ipoNumber',e.target.value);setIpoError('');setIpoCheck('');}} onBlur={async()=>{const number=input.ipoNumber?.trim();if(!number)return;setIpoCheck('Checking IPO number…');try{const result=await api<{available:boolean}>(`/project-workflow/ipo-number-availability?number=${encodeURIComponent(number)}`);setIpoCheck(result.available?'IPO number is available.':'');setIpoError(result.available?'':'This IPO number is already in use. Enter a different number or leave blank for automatic numbering.');}catch(e){setIpoCheck('');setIpoError(e instanceof Error?e.message:'Unable to check IPO number.');}}}/>
              <small>The number is assigned only after sale confirmation. Duplicate numbers are blocked.</small>
              {ipoCheck&&<span role="status">{ipoCheck}</span>}{ipoError&&<span className="form-error" role="alert">{ipoError}</span>}
            </label>}
            {saleConfirmationFields
              .filter(([field]) => !customerFields.includes(field))
              .map(renderField)}
          </fieldset>
          <section className="ipo-customer-summary">
            <h3>{r.customer}</h3>
            <p>
              {input.contactPerson || r.customer} · {input.phone || "N/A"} ·{" "}
              {input.email || "N/A"}
            </p>
            <p>Billing address: {input.billingAddress || "Need to enter"}</p>
            <details>
              <summary>Edit customer &amp; billing details</summary>
              <fieldset className="order-fields" disabled={busy}>
                {saleConfirmationFields
                  .filter(([field]) => customerFields.includes(field))
                  .map(renderField)}
              </fieldset>
            </details>
          </section>
          {savedDirectPo&&<details className="pz-form-section"><summary>Evidence reading and correction history</summary>{savedDirectPo.history.map((h:any,i:number)=><section key={i}><p>{h.actorName} · {new Date(h.at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})} PKT</p>{h.changes.length?<ul>{h.changes.map((v:any)=><li key={v.field}>{v.label}: {v.before||'Not entered'} → {v.after||'Not entered'}</li>)}</ul>:<p>Saved without corrections.</p>}</section>)}</details>}
          <p className="form-note">
            Operations collects delivery address, site contact and delivery
            schedule after receiving the BOQ.
          </p>
          {!directUps && input.evidenceType && <fieldset className="order-fields" disabled={busy}>{evidenceUpload}</fieldset>}
          {progress && <p role="status">{progress}</p>}
          {document && (
            <>

              <details>
                <summary>View uploaded evidence</summary>
                <DocumentPreview
                  url={`/api/project-workflow/${r.id}/files/${document.id}`}
                  title={document.filename}
                  mime={document.mime}
                />
              </details>
            </>
          )}
          </>}
          {po && document && !reviewingDirectPo && (
            <>
              <h3>PO Comparison Summary</h3>
              {preAgreedBank&&poInclusive&&poPrintedTax!==""&&Number(poPrintedTax)===0&&<p className="form-note">Customer PO payable includes tax. Printed Sales Tax: PKR {money(poPrintedTax)}. Approved embedded GST: PKR {money(basis?.comparison.tax??"0")}. The IPO retains the approved GST allocation; the printed zero does not make this a zero-tax deal.</p>}
              {issues.length ? (
                <ul>
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>{!poTotal && preAgreedBank ? "PO amount is unreadable or redacted. Evidence fields remain blank; IPO/PT pricing comes from the selected accepted agreement." : "Readable PO values match the approved basis."}</p>
              )}
              <details>
                <summary>Correct unreadable PO amounts</summary>
                <fieldset className="order-fields">
                  <label>
                    Total including tax
                    <input
                      inputMode="decimal"
                      value={poTotal}
                      onChange={(e) =>
                        setPoTotal(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                    />
                  </label>
                  <label>
                    Sales tax
                    <input
                      inputMode="decimal"
                      value={poTax}
                      onChange={(e) =>
                        setPoTax(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                    />
                  </label>
                </fieldset>
              </details>
              {!preAgreedBank && <label className="pz-review-check">
                <input
                  type="checkbox"
                  checked={scope}
                  onChange={(e) => setScope(e.target.checked)}
                />
                I checked the PO’s configuration, scope, quantities and terms
                against the approved document.
              </label>}
            </>
          )}
          <label className="pz-review-check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            Customer approved this exact quotation or pre-agreed configuration.
          </label>
          {!reviewingDirectPo && previewPanel}
          {salePreview && !currentPreview && (
            <p className="form-note">
              Details changed. Refresh the IPO and PT previews before confirming
              sale.
            </p>
          )}
          <div className="pz-action-row">
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void previewDocuments()}
            >
              Preview IPO &amp; PT
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={busy}
            >
              Confirm Sale &amp; Issue
            </Button>
          </div>
          {confirmationRequirements.length > 0 && (
            <div className="form-note" role="status">
              <strong>Before confirming sale:</strong>
              <ul>
                {confirmationRequirements.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
