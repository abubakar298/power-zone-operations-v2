import './commercial-layout.css';
import {departmentFetch} from '../department-view.js';
import {prepareReviewedQuotationInput,saveReviewedQuotation} from '../save-reviewed-quotation.js';
import {RevisionPricingSummary} from '../components/RevisionPricingSummary.js';
import {RevisionReasonFields} from '../components/RevisionReasonFields.js';
import {
  RevisionComparison,
  hasRevisionPriceChange,
} from "../components/RevisionComparison.js";
import { Button } from "../ui/Button.js";
import {DiscountApprovalEvidence} from '../components/DiscountApprovalEvidence.js';
import {discountedSellingReview} from '../../server/commercial/engine.js';
import {
  confirmLeaveWorkspace,
  useUnsavedChanges,
} from "../hooks/useUnsavedChanges.js";
import type { CommercialPolicy } from "../../server/commercial/active-policy.js";
import { money } from "../numbers.js";
import { SharePdf } from "../components/SharePdf.js";
import { QuotationWorkflow } from "./QuotationWorkflow.js";
import { confirmTransition, confirmRevision } from "../confirm.js";
import { createPortal } from "react-dom";
const pdfWorker='/api/commercial/pdf-worker.mjs';
import { Decimal } from "decimal.js";
import { useEffect, useRef, useState } from "react";
import { api, type Session } from "../api.js";
import type {
  PricingInput,
  QuotationInput,
} from "../../server/commercial/schema.js";
import type {
  PricingSnapshot,
  QuotationSnapshot,
} from "../../server/commercial/engine.js";
const defaults = (name: string, id = ""): PricingInput => ({
  boqRevisionId: id,
  cashGstTreatment:undefined,
  presentation: "No Breakup",
  taxMode: "Show Sales Tax Separately",
  markups: {
    solar: "10",
    structure: "10",
    bess: "0",
    earthing: "10",
    balance: "25",
    rest: "25",
  },
  discountMode: "Pre-approved",
  preparedBy: name,
  remarks: "",
});
function editablePricing(p: PricingSnapshot): PricingInput {
  if (p.policy)
    return {
      ...p.input,
      markups: { ...defaults(p.input.preparedBy).markups, ...p.input.markups },
    };
  const markups = {
    ...defaults(p.input.preparedBy).markups,
    ...p.input.markups,
  };
  for (const r of p.rows)
    if (r.key !== "additional" && r.markup != null) markups[r.key] = r.markup;
  return { ...p.input, markups };
}
export function QuotationView({
  showActions = true,
  snapshot: s,
  number,
  pdfUrl,
  discount,
  onDiscount,
  draftInput,
  csrf,
  refreshKey,
}: {
  showActions?: boolean;
  snapshot: QuotationSnapshot;
  number?: string;
  pdfUrl?: string;
  discount?: string;
  onDiscount?: (value: string) => void;
  draftInput?: QuotationInput;
  csrf?: string;
  refreshKey?: number;
}) {
  const pages = useRef<HTMLDivElement>(null);
  const [pdfError, setPdfError] = useState("");
  const [discountAnchor, setDiscountAnchor] = useState<{
    host: HTMLDivElement;
    top: number;
    height: number;
    netTop: number;
  }>();
  const serialized = draftInput
    ? JSON.stringify({ ...draftInput, discount: s.input.discount })
    : "";
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let task: any;
    async function render() {
      setPdfError("");
      try {
        const response = await departmentFetch(
          pdfUrl ?? "/api/commercial/quotations/preview.pdf",
          {
            method: pdfUrl ? "GET" : "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
            ...(pdfUrl
              ? {}
              : {
                  headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrf ?? "",
                  },
                  body: serialized,
                }),
          },
        );
        if (!response.ok)
          throw new Error(
            (await response.json()).message ?? "Unable to load quotation PDF.",
          );
        const data = await response.arrayBuffer();
        const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdf.GlobalWorkerOptions.workerSrc = pdfWorker;
        task = pdf.getDocument({ data });
        const document = await task.promise;
        const canvases: HTMLDivElement[] = [];
        let anchor:
          | {
              host: HTMLDivElement;
              top: number;
              height: number;
              netTop: number;
            }
          | undefined;
        for (let i = 1; i <= document.numPages; i++) {
          if (cancelled) return;
          const page = await document.getPage(i),
            viewport = page.getViewport({ scale: 1.5 });
          const canvas = window.document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.setAttribute("aria-label", `Quotation PDF page ${i}`);
          await page.render({
            canvasContext: canvas.getContext("2d")!,
            canvas,
            viewport,
          }).promise;
          const host = window.document.createElement("div");
          host.className = "quotation-pdf-page";
          host.append(canvas);
          const content = await page.getTextContent();
          const label = content.items.find(
            (item: any) => item.str === "Special Discount",
          ) as any;
          if (label) {
            const baseline = viewport.convertToViewportPoint(
              0,
              label.transform[5],
            )[1];
            const height = Math.max(label.height * viewport.scale, 10);
            const net = content.items.find(
              (item: any) => item.str === "Net Total",
            ) as any;
            anchor = {
              host,
              netTop: net
                ? ((viewport.convertToViewportPoint(0, net.transform[5])[1] -
                    height) /
                    viewport.height) *
                  100
                : 0,
              top: ((baseline - height) / viewport.height) * 100,
              height: ((height + 3) / viewport.height) * 100,
            };
          }
          canvases.push(host);
        }
        if (!cancelled) {
          pages.current?.replaceChildren(...canvases);
          setDiscountAnchor(anchor);
        }
      } catch (e) {
        if (!cancelled)
          setPdfError(e instanceof Error ? e.message : "Unable to load PDF.");
      }
    }
    void render();
    return () => {
      cancelled = true;
      controller.abort();
      void task?.destroy();
    };
  }, [pdfUrl, serialized, csrf, refreshKey]);
  return (
    <section className="boq-costing quotation-preview">
      <div className="panel-heading">
        <h2>{number ?? "Quotation preview"}</h2>
        {pdfUrl && showActions && (
          <>
            <a className="dark-button" href={pdfUrl} download>
              Download quotation PDF
            </a>
            <SharePdf url={pdfUrl} filename={`${number ?? "Quotation"}.pdf`} />
          </>
        )}
      </div>
      {pdfError && <p role="alert">{pdfError}</p>}
      <div className="quote-metadata sr-only">Validity {s.input.validity}</div>
      <div
        className="quotation-pdf-pages"
        ref={pages}
        aria-label="Quotation PDF preview"
      />
      {onDiscount &&
        discountAnchor &&
        createPortal(
          <input
            className="pdf-inline-discount"
            aria-label="Quotation discount (PKR)"
            type="number"
            min="0"
            step="0.01"
            style={{
              top: `${discountAnchor.top}%`,
              height: `${discountAnchor.height}%`,
            }}
            value={discount ?? s.input.discount}
            onChange={(e) => onDiscount(e.target.value)}
          />,
          discountAnchor.host,
        )}
      {onDiscount &&
        discountAnchor &&
        createPortal(
          <strong
            className="pdf-inline-net"
            style={{
              top: `${discountAnchor.netTop}%`,
              height: `${discountAnchor.height}%`,
            }}
          >
            {money(s.footer.at(-1)!.amount)}
          </strong>,
          discountAnchor.host,
        )}
      {onDiscount && (
        <span className="sr-only">
          Net Total: PKR {money(s.footer.at(-1)!.amount)}
        </span>
      )}
    </section>
  );
}
export function Commercial({
  session,
  initialRevisionId,
  initialFrameworkInput,
  section = "pricing",
  onRevisionDraft,
  onRevisionPricing,
  initialRequestId,
  initialQuotationId,
  startQuotationRevision,
  initialPricingId,
  onQuotationSent,
}: {
  session: Session;
  initialRevisionId?: string;
  initialFrameworkInput?: Partial<PricingInput>;
  section?: "pricing" | "quotes";
  onRevisionDraft?: (id: string,preparationEdit?:boolean) => void;
  onRevisionPricing?: (id: string, requestId: string) => void;
  initialRequestId?: string;
  initialQuotationId?: string;
  startQuotationRevision?:boolean;
  initialPricingId?: string;
  onQuotationSent?: () => void;
}) {
  const financialManager = session.user.restrictedCostAccess === true;
  const manager = ["Admin", "Management", "Coordinator"].includes(
    session.user.role,
  );
  const [priceChangeAcknowledged, setPriceChangeAcknowledged] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pricingUpdating,setPricingUpdating]=useState(false);
  const [reloadProtected,setReloadProtected]=useState(false);
  const [policy, setPolicy] = useState<CommercialPolicy>();
  const [boqs, setBoqs] = useState<any[]>([]),
    [prices, setPrices] = useState<any[]>([]),
    [quotes, setQuotes] = useState<any[]>([]),
    [input, setInput] = useState<PricingInput>(
      {...defaults(session.user.displayName, initialRevisionId),...initialFrameworkInput,markups:{...defaults(session.user.displayName).markups,...initialFrameworkInput?.markups}},
    ),
    [preview, setPreview] = useState<{
      snapshot: PricingSnapshot;
      fingerprint: string;
    }>(),
    [savedPrice, setSavedPrice] = useState<any>(),
    [quoteInput, setQuoteInput] = useState<QuotationInput>(),
    [quotePreview, setQuotePreview] = useState<{
      snapshot: QuotationSnapshot;
      fingerprint: string;
      refreshVersion?: number;
    }>(),
    [savedQuote, setSavedQuote] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [key, setKey] = useState(crypto.randomUUID());
  useUnsavedChanges(dirty,!reloadProtected||Boolean(quoteInput));
  useEffect(()=>{
    const token=new URLSearchParams(window.location.search).get('pricingPreviewToken');
    if(!token||!dirty||!input.boqRevisionId)return;
    try{sessionStorage.setItem(`pz-pricing-preview:${session.user.id}:${token}`,JSON.stringify(input));setReloadProtected(true);}catch{setReloadProtected(false);}
  },[input,dirty,session.user.id]);
  const [sendError,setSendError]=useState("");
  const [revisionDialog, setRevisionDialog] = useState(false),
    [revisionInfo, setRevisionInfo] = useState<any>(),
    [revisionOrigin, setRevisionOrigin] = useState("Internal management"),
    [revisionReason, setRevisionReason] = useState(""),
    [revisionRequester, setRevisionRequester] = useState(
      session.user.displayName,
    ),
    [costingChoice, setCostingChoice] = useState("");
  const [revisionLoading, setRevisionLoading] = useState(
    !!(
      manager &&
      initialRevisionId &&
      !initialQuotationId &&
      !initialPricingId
    ),
  );
  const [revisionRequests, setRevisionRequests] = useState<any[]>([]);
  const [openedProjectRevision,setOpenedProjectRevision]=useState(false);
  useEffect(()=>{if(startQuotationRevision&&savedQuote&&!openedProjectRevision){setOpenedProjectRevision(true);setRevisionDialog(true);setRevisionReason(savedQuote.workflow_notes??'');setCostingChoice('');}},[startQuotationRevision,savedQuote,openedProjectRevision]);
  const [preparationEdit,setPreparationEdit]=useState<{canEdit:boolean;quoted:boolean}>();
  useEffect(()=>{let active=true;setPreparationEdit(undefined);if(input.boqRevisionId&&!savedQuote)void api<{canEdit:boolean;quoted:boolean}>(`/boqs/${input.boqRevisionId}/preparation`).then(value=>{if(active)setPreparationEdit(value);}).catch(()=>{});return()=>{active=false;};},[input.boqRevisionId,savedQuote]);
  const boqRevisionLocked = Boolean(initialRevisionId) || Boolean(new URLSearchParams(window.location.search).get("pricingPreviewToken")) || boqs.some(b => b.id === input.boqRevisionId && b.from_technical_report === true);
  const directSale =
    (boqs.find((b) => b.id === input.boqRevisionId)?.family ??
      savedPrice?.snapshot.boqFamily) === "direct-product";
  async function load() {
    const [b, q] = await Promise.all([
      api<{ boqs: any[] }>("/boqs"),
      api<{ quotations: any[] }>("/commercial/quotations"),
    ]);
    if (session.user.role !== "Coordinator") setPolicy(await api<CommercialPolicy>("/commercial/standard-policy"));
    setBoqs(b.boqs);
    setQuotes(q.quotations);
    if(session.user.role!=="Coordinator")setRevisionRequests(
      (await api<{ requests: any[] }>("/commercial/revision-requests"))
        .requests,
    );
    if (manager&&session.user.role!=="Coordinator")
      setPrices((await api<{ pricing: any[] }>("/commercial/pricing")).pricing);
  }
  useEffect(() => {
    void load().catch(fail);
    const carryToken=new URLSearchParams(window.location.search).get('pricingPreviewToken');
    if(carryToken&&!initialRevisionId&&!initialQuotationId&&!initialPricingId){void api<PricingInput>(`/commercial/pricing-preview-context/${carryToken}`).then(value=>{let restored=value;try{const saved=JSON.parse(sessionStorage.getItem(`pz-pricing-preview:${session.user.id}:${carryToken}`)??'null');if(saved?.boqRevisionId===value.boqRevisionId)restored=saved;}catch{}setInput(restored);setDirty(true);setNotice('Your entered quotation settings and discount evidence have been preserved in this preview.');}).catch(fail);}
    if (initialQuotationId) void openQuote(initialQuotationId);
    if (initialPricingId) void selectPrice(initialPricingId);
    if (
      manager &&
      initialRevisionId &&
      !initialQuotationId &&
      !initialPricingId
    )
      void (async () => {
        if (initialRequestId) {
          const rs = await api<{ requests: any[] }>(
            "/commercial/revision-requests",
          );
          const r = rs.requests.find((x) => x.id === initialRequestId);
          if (!r) throw new Error("Revision request not found.");
          const source = await api<any>(
            `/commercial/pricing/${r.source_pricing_id}`,
          );
          setRevisionInfo(r);
          setInput({
            ...editablePricing(source.snapshot),
            boqRevisionId: initialRevisionId,
            revisionRequestId: r.id,
          });
          setNotice(
            `${r.origin}: ${r.reason}. Review commercial pricing for this revision.`,
          );
        } else {
          const r = await api<any>(
            `/commercial/revision-context/${initialRevisionId}`,
          );
          if (r) {
            setRevisionInfo(r);
            setInput({
              ...r.pricing_input,
              markups: {
                ...defaults(session.user.displayName).markups,
                ...r.pricing_input.markups,
              },
              boqRevisionId: initialRevisionId,
              revisionRequestId: r.id,
            });
          }
        }
      })()
        .catch(fail)
        .finally(() => setRevisionLoading(false));
  }, []);
  async function applyApprovalInstructions(id: string) {
    const source = await api<any>(`/boqs/${id}`);
    if (source.snapshot.survey.family === "direct-product")
      setInput((old) =>
        old.boqRevisionId === id
          ? {
              ...old,
              presentation:
                old.presentation === "Basic Breakup"
                  ? "Full Breakup"
                  : old.presentation,
            }
          : old,
      );

    const a = await api<any>(`/boqs/${id}/instructions`);
    if (a) {
      setInput((old) =>
        old.boqRevisionId === id
          ? {
              ...old,
              presentation:
                source.snapshot.survey.family === "direct-product" &&
                a.instructions.presentation === "Basic Breakup"
                  ? "Full Breakup"
                  : a.instructions.presentation,
              taxMode: a.instructions.taxMode,
              saleType: a.instructions.saleType,
              cashGstTreatment:
                a.instructions.saleType === "Cash Deal"
                  ? a.instructions.cashGstTreatment
                  : undefined,
              markups: a.instructions.markups
                ? {
                    ...defaults(session.user.displayName).markups,
                    ...a.instructions.markups,
                  }
                : defaults(session.user.displayName).markups,
              remarks: a.instructions.notes,
            }
          : old,
      );
      setNotice(
        `Costing approval instructions loaded · ${a.channel} · ${a.claimed_approver}.`,
      );
    }
  }
  useEffect(() => {
    if (
      initialRevisionId &&
      !initialRequestId &&
      !initialQuotationId &&
      !initialPricingId
    ) {
      void api<any>(`/commercial/revision-context/${initialRevisionId}`)
        .then((context) => {
          if (!context) return applyApprovalInstructions(initialRevisionId);
        })
        .catch(fail);
    }
  }, []);
  function fail(e: unknown) {
    setError(
      e instanceof Error ? e.message : "Unable to complete this action.",
    );
  }
  async function action(fn: () => Promise<void>,sendAction=false) {
    if (busy) return;
    setBusy(true);
    if(sendAction)setSendError("");else setError("");
    try {
      await fn();
    } catch (e) {
      if(sendAction)setSendError(e instanceof Error?e.message:"Unable to send the quotation.");else fail(e);
    } finally {
      setBusy(false);
    }
  }
  function update(p: Partial<PricingInput>) {
    setDirty(true);
    setInput({ ...input, ...p });
    setPricingUpdating(true);
    setSavedPrice(undefined);
    setQuoteInput(undefined);
    setQuotePreview(undefined);
    setSavedQuote(undefined);
    setKey(crypto.randomUUID());
    setNotice("");
  }
  function roundTotal(value:string){
    value=value.replace(/,/g,'');
    if(!/^\d*(?:\.\d*)?$/.test(value))return;
    if(!value.trim()){update({roundedTotal:undefined});return;}
    if(value==='.')value='0.';
    if(!preview)return;
    const target=new Decimal(value),original=new Decimal(preview.snapshot.total);
    const percentage=original.isZero()?'0':new Decimal(100).mul(new Decimal(1).sub(target.div(original))).toDecimalPlaces(6).toString();
    update({discountMode:'Custom',roundedTotal:value,...(target.gte(0)&&target.lte(original)?{discountPercent:percentage}:{})});
  }
  async function pricingPreview() {
    await action(async () => {
      setPreview(
        await api("/commercial/pricing/preview", {
          body: {...input,discountPercent:input.discountMode==='Pre-approved'?undefined:input.discountPercent?.trim()||'0'},
          csrf: session.csrfToken,
        }),
      );
      setPricingUpdating(false);
      setNotice(
        "Review the internal pricing, then save an immutable pricing version.",
      );
    });
  }
  useEffect(() => {
    if (
      (initialQuotationId && !revisionInfo) ||
      (section !== "pricing" && !revisionInfo) ||
      (!policy && session.user.role !== "Coordinator") ||
      revisionLoading ||
      !input.boqRevisionId ||
      savedPrice
    )
      return;
    let active = true;
    setPricingUpdating(true);
    const timer = setTimeout(() => {
      api<{ snapshot: PricingSnapshot; fingerprint: string }>(
        "/commercial/pricing/preview",
        { body: {...input,discountPercent:input.discountMode==='Pre-approved'?undefined:input.discountPercent?.trim()||'0'}, csrf: session.csrfToken },
      )
        .then((r) => {
          if (active){setPreview(r);setPricingUpdating(false);setError('');if((input.discountMode==='Pre-approved'||input.roundedTotal!==undefined)&&r.snapshot.input.discountPercent!==input.discountPercent)setInput(old=>({...old,discountPercent:r.snapshot.input.discountPercent}));}
        })
        .catch((e) => {
          if (active){setPricingUpdating(false);fail(e);}
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [initialRevisionId, policy, revisionLoading, revisionInfo, input, savedPrice]);
  async function pricingSave() {
    if (!preview||pricingUpdating) return;
      await prepareQuote({
        pricingId: crypto.randomUUID(),
        previewPricing:{...input,discountPercent:input.discountMode==='Pre-approved'?undefined:input.discountPercent?.trim()||'0'},
        revisionRequestId: input.revisionRequestId,
        includeDiscountInSellingPrice: input.includeDiscountInSellingPrice,
        quotedDate: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Karachi",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        validity: "7 Days",
        proposedBy: session.user.displayName,
      });
  }
  async function selectPrice(id: string) {
    if (!confirmLeaveWorkspace()) return;
    setDirty(false);
    await action(async () => {
      const p = await api<any>(`/commercial/pricing/${id}`);
      setSavedPrice(p);
      setInput(editablePricing(p.snapshot));
      setPreview({ snapshot: p.snapshot, fingerprint: p.fingerprint });
      setSavedQuote(undefined);
      setQuoteInput(undefined);
      setQuotePreview(undefined);
      setNotice(
        "Saved pricing opened. Change inputs to create another pricing version.",
      );
    });
  }
  async function prepareQuote(copy?: QuotationInput) {
    if (!savedPrice && !copy) return;
    await action(async () => {
      let data: QuotationInput = copy ?? {
        pricingId: savedPrice.id,
        discount: savedPrice.snapshot.discount,
        includeDiscountInSellingPrice: savedPrice.snapshot.input.includeDiscountInSellingPrice,
        revisionRequestId: savedPrice.snapshot.input.revisionRequestId,
        quotedDate: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Karachi",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        validity: "7 Days",
        proposedBy: session.user.displayName,
      };
      if (copy&&!copy.previewPricing) {
        const source = await api<any>(`/commercial/pricing/${data.pricingId}`);
        setSavedPrice(source);
        setInput({
          ...editablePricing(source.snapshot),
          revisionRequestId: copy.revisionRequestId,
        });
        setPreview({
          snapshot: source.snapshot,
          fingerprint: source.fingerprint,
        });
      }
      if (
        data.revisionRequestId &&
        !data.previewPricing &&
        data.discount === undefined &&
        revisionInfo
      ) {
        const prior = await api<QuotationInput>(
          `/commercial/quotations/${revisionInfo.source_quotation_id}/copy`,
        );
        data.discount = prior.discount;
      }
      if (
        !copy &&
        data.revisionRequestId &&
        revisionInfo &&
        !revisionInfo.costing_change
      ) {
        const prior = await api<QuotationInput>(
          `/commercial/quotations/${revisionInfo.source_quotation_id}/copy`,
        );
        data.additionalItem = prior.additionalItem;
      }
      data=await prepareReviewedQuotationInput(data,(path,body)=>api<any>(path,{body,csrf:session.csrfToken}));
      const result = await api<{
        snapshot: QuotationSnapshot;
        fingerprint: string;
      }>("/commercial/quotations/preview", {
        body: data,
        csrf: session.csrfToken,
      });
      setDirty(true);
      setInput(old=>({...old,includeDiscountInSellingPrice:data.includeDiscountInSellingPrice??data.previewPricing?.includeDiscountInSellingPrice??input.includeDiscountInSellingPrice}));
      setQuoteInput({
        ...data,
        discount: result.snapshot.input.discount,
        descriptions: result.snapshot.lines
          .slice(0, result.snapshot.scopeCount)
          .map((l) => l.description),
      });
      setQuotePreview(result);
      setPriceChangeAcknowledged(false);
      setQuotePdfInput(data);
      setSavedQuote(undefined);
      setKey(crypto.randomUUID());
      setNotice(
        "Review customer descriptions and the quotation before saving.",
      );
    });
  }
  async function calculateQuote() {
    if (!quoteInput) return;
    const sequence = ++previewSequence.current;
    await action(async () => {
      const result = await api<{
        snapshot: QuotationSnapshot;
        fingerprint: string;
      }>("/commercial/quotations/preview", {
        body: { ...quoteInput, discount: quoteInput.discount?.trim() || "0" },
        csrf: session.csrfToken,
      });
      if (sequence === previewSequence.current) {
        setQuotePreview({...result,refreshVersion:sequence});
        setPriceChangeAcknowledged(false);
        setQuotePdfInput(quoteInput);
      }
    });
  }
  async function saveQuote(submit = false) {
    if (!quoteInput || !quotePreview) return;
    if (
      !(await confirmRevision(
        submit
          ? quotePreview.snapshot.discountAuthorization && !quotePreview.snapshot.discountAuthorization.requiresManagementApproval && !(quotePreview.snapshot as QuotationSnapshot & {revision?:unknown}).revision && !quoteInput.additionalItem ? "Approve quotation within pre-approved allowance" : "Save and send quotation for approval"
          : quoteInput.revisionRequestId ? "Save revision" : "Save quotation version",
        "This preserves the quotation prices, discount and terms as an immutable version.",
        submit ? "Save and send" : quoteInput.revisionRequestId ? "Save Revision" : "Save quotation",
      ))
    )
      return;
    await action(async () => {
      const {quotation:q}=await saveReviewedQuotation({input:quoteInput,requestKey:key,pricingFingerprint:preview?.fingerprint,acknowledgePriceChange:priceChangeAcknowledged,onPreview:(latest,current)=>{setQuotePreview(latest);setQuotePdfInput(current);}},(path,body)=>body===undefined?api<any>(path):api<any>(path,{body,csrf:session.csrfToken}));
      // The saved review is recoverable even if the later send action fails.
      setDirty(false);setSavedQuote(q);setQuoteInput(undefined);
      if (submit) {
        try{await api("/coordinator/events", {
          body: { quotationId: q.id, kind: quotePreview.snapshot.discountAuthorization && !quotePreview.snapshot.discountAuthorization.requiresManagementApproval && !(quotePreview.snapshot as QuotationSnapshot & {revision?:unknown}).revision && !quoteInput.additionalItem ? "Approved" : "Submitted", notes: "" },
          csrf: session.csrfToken,
        });}catch(e){throw new Error(`Quotation saved, but it was not sent. ${e instanceof Error?e.message:"Please retry the send action."}`);}
        setDirty(false);setSavedQuote(q);setQuoteInput(undefined);
        if(onQuotationSent){onQuotationSent();return;}
      }
      setDirty(false);setSavedQuote(q);setQuoteInput(undefined);
      await load();
      setNotice(
        `${q.number} saved. Earlier quotation versions remain unchanged.`,
      );
    },submit);
  }
  async function openQuote(id: string) {
    if (!confirmLeaveWorkspace()) return;
    setDirty(false);
    await action(async () => {
      setSavedQuote(await api(`/commercial/quotations/${id}`));
      setQuoteInput(undefined);
      setQuotePreview(undefined);
    });
  }
  const [quotePdfInput, setQuotePdfInput] = useState<QuotationInput>();
  const previewSequence = useRef(0);
  const quoteFields = quoteInput
    ? JSON.stringify({ ...quoteInput, discount: undefined })
    : "";
  // Text/date/validity edits remain local until the user requests a refreshed preview.
  useEffect(() => {}, [quoteFields]);
  function quoteChange(p: Partial<QuotationInput>) {
    setDirty(true);
    ++previewSequence.current;
    setQuoteInput({ ...quoteInput!, ...p });
    setQuotePreview((old) => (old ? { ...old, fingerprint: "" } : old));
    setSavedQuote(undefined);
    setKey(crypto.randomUUID());
  }
  function changeQuotationDiscount(value: string) {
    if(quoteInput?.includeDiscountInSellingPrice){
      quoteChange({discount:value});
      setNotice('Preview the quotation to recalculate selling prices and GST.');
      return;
    }
    ++previewSequence.current;
    if (!quoteInput || !quotePreview) return;
    setDirty(true);
    setQuoteInput({ ...quoteInput, discount: value });
    setKey(crypto.randomUUID());
    const footer = quotePreview.snapshot.footer;
    const oldDiscount = footer.find(
      (r) => r.label === "Special Discount",
    )!.amount;
    const oldNet = footer.find((r) => r.label === "Net Total")!.amount;
    const total = new Decimal(oldDiscount).add(oldNet);
    const normalized = value.trim() || "0";
    const valid =
      /^\d{1,12}(\.\d{1,2})?$/.test(normalized) &&
      new Decimal(normalized).lte(total);
    setQuotePreview({
      fingerprint: "",
      snapshot: {
        ...quotePreview.snapshot,
        footer: valid
          ? footer.map((r) => ({
              ...r,
              amount:
                r.label === "Special Discount"
                  ? new Decimal(normalized).toFixed(2)
                  : r.label === "Net Total"
                    ? total.minus(normalized).toFixed(2)
                    : r.amount,
            }))
          : footer,
      },
    });
    setNotice(
      valid
        ? "Net total updated. Confirm quotation totals before saving."
        : "Enter a nonnegative discount up to the quotation total, with at most two decimals.",
    );
  }
  const p = preview?.snapshot;
  const sellingOnly=session.user.role==='Coordinator';
  const discountReview=p?discountedSellingReview(p):undefined;
  const visibleRows = p?.rows.filter(r=>sellingOnly||financialManager||(r.key!=="bess"&&r.cost!=null&&r.markup!=null))??[];
  const visibleCost = visibleRows
    .reduce((sum, r) => sum.add(r.cost??0), new Decimal(0))
    .toFixed(2);
  return (
    <section className="commercial-section">
      <p>
        Commercial pricing uses the selected saved BOQ revision. Atif may approve quotations within the standard discount allowance; Management approves further discounts. Saved versions retain their original
        inputs and amounts.
      </p>
      {!savedQuote&&!input.revisionRequestId&&onRevisionDraft&&preparationEdit?.canEdit&&<div className="pz-actions"><Button variant="neutral" disabled={busy} onClick={()=>void action(async()=>{const result=await api<{draftId:string}>(`/boqs/${input.boqRevisionId}/edit-preparation`,{csrf:session.csrfToken,body:{}});onRevisionDraft(result.draftId,true);})}>Edit BOQ</Button></div>}
      {dirty && <p role="status">Unsaved quotation preparation changes</p>}
      {revisionInfo && (
        <aside className="detail-panel" aria-label="Requested revision">
          <h3>Requested changes</h3>
          <p>
            {revisionInfo.origin} · {revisionInfo.reason}
          </p>
          <p>
            The revised quotation returns to Management approval before customer
            confirmation.
          </p>
        </aside>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-note">
          {notice}
        </p>
      )}
      {(section === "pricing" || revisionInfo) && manager && !quoteInput && !quotePreview && (
        <>
          <form
            className="survey-form"
            onSubmit={(e) => {
              e.preventDefault();
              void pricingPreview();
            }}
          >
            <fieldset disabled={busy || revisionLoading}>
              <legend>Quotation Settings</legend>
              <div className="survey-grid">
                <label>
                  BOQ revision
                  <select
                    aria-label="BOQ revision"
                    disabled={boqRevisionLocked}
                    aria-describedby={boqRevisionLocked ? "technical-boq-revision-note" : undefined}
                    value={input.boqRevisionId}
                    onChange={(e) => {
                      const id = e.target.value;
                      update({ boqRevisionId: id });
                      if (id) void applyApprovalInstructions(id).catch(fail);
                    }}
                    required
                  >
                    <option value="">Select approved revision</option>
                    {boqs.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.number} · {b.site}
                        {financialManager && b.total != null
                          ? ` · PKR ${money(b.total)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {boqRevisionLocked && <small id="technical-boq-revision-note">The BOQ revision is fixed for this quotation preparation. Review or revise its inputs in the BOQ preparation page.</small>}
                </label>
                <label>
                  Price presentation
                  <select
                    aria-label="Price presentation"
                    value={input.presentation}
                    onChange={(e) =>
                      update({
                        presentation: e.target
                          .value as PricingInput["presentation"],
                      })
                    }
                  >
                    <option>No Breakup</option>
                    {!directSale && <option>Basic Breakup</option>}
                    <option value="Full Breakup">
                      {directSale ? "Breakup" : "Full Breakup"}
                    </option>
                  </select>
                </label>
                {directSale && input.presentation === "Full Breakup" && (
                  <label>
                    Complete BESS package pricing
                    <select
                      aria-label="Complete BESS package pricing"
                      value={input.groupBessPackages ? "grouped" : "separate"}
                      onChange={(e) =>
                        update({
                          groupBessPackages: e.target.value === "grouped",
                        })
                      }
                    >
                      <option value="separate">
                        Show inverter, battery and BMS prices separately
                      </option>
                      <option value="grouped">
                        One combined amount per complete BESS package
                      </option>
                    </select>
                  </label>
                )}
                <label>
                  Quotation type
                  <select
                    value={input.saleType ?? "Tax Deal"}
                    onChange={(e) =>
                      update({
                        saleType: e.target.value as PricingInput["saleType"],
                        cashGstTreatment:
                          e.target.value === "Cash Deal"
                            ? "No GST added"
                            : undefined,
                      })
                    }
                  >
                    <option>Tax Deal</option>
                    <option>Cash Deal</option>
                  </select>
                </label>
                {input.saleType === "Cash Deal" && (
                  <label>
                    Cash deal GST treatment
                    <select
                      value={input.cashGstTreatment ?? "No GST added"}
                      onChange={(e) =>
                        update({
                          cashGstTreatment: e.target
                            .value as PricingInput["cashGstTreatment"],
                          taxMode: "Tax Included",
                        })
                      }
                    >
                      <option>No GST added</option>
                      <option>Included in selling price</option>
                    </select>
                  </label>
                )}
                <label>
                  Tax presentation
                  <select
                    aria-label="Tax presentation"
                    value={input.taxMode}
                    onChange={(e) =>
                      update({
                        taxMode: e.target.value as PricingInput["taxMode"],
                      })
                    }
                  >
                    <option>Tax Included</option>
                    <option>Show Sales Tax Separately</option>
                  </select>
                </label>
                <label>
                  Additional scope category (if included in the BOQ)
                  <select
                    aria-label="Additional scope category"
                    value={input.additionalCategory ?? ""}
                    onChange={(e) =>
                      update({
                        additionalCategory:
                          (e.target
                            .value as PricingInput["additionalCategory"]) ||
                          undefined,
                      })
                    }
                  >
                    <option value="">
                      Select category if additional scope exists
                    </option>
                    <option value="solar">Solar panels</option>
                    <option value="structure">Structure</option>
                    <option value="earthing">Earthing bore</option>
                    <option value="bess">Inverter, battery or BMS</option>
                    <option value="other">Everything else</option>
                  </select>
                </label>
                {(input.additionalMarkup !== undefined ||
                  p?.rows.some((r) => r.key === "additional")) && (
                  <label>
                    Additional scope tax category
                    <select
                      aria-label="Additional scope tax category"
                      value={
                        input.additionalTaxRate ??
                        p?.rows.find((r) => r.key === "additional")?.taxRate ??
                        "18"
                      }
                      onChange={(e) =>
                        update({
                          additionalTaxRate: e.target.value as
                            "0" | "10" | "18",
                        })
                      }
                    >
                      <option value="18">Other items — 18%</option>
                      <option value="10">Solar — 10%</option>
                      <option value="0">No tax — 0%</option>
                    </select>
                  </label>
                )}
                <label>
                  Discount (%)
                  <input
                    aria-label="Discount (%)"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={input.roundedTotal!==undefined||input.discountMode==='Pre-approved'?new Decimal(input.discountPercent||'0').toFixed(1):input.discountPercent??"0"}
                    onChange={(e) => update({ discountMode:'Custom',discountPercent: e.target.value,roundedTotal:undefined })}
                    onBlur={()=>{if(input.discountMode!=='Pre-approved'&&input.roundedTotal===undefined&&input.discountPercent?.trim()&&new Decimal(input.discountPercent).gte(0)&&new Decimal(input.discountPercent).lte(100)){const value=new Decimal(input.discountPercent).toFixed(1);if(value!==input.discountPercent)update({discountPercent:value});}}}
                  />
                  <small>{preview?.snapshot.discountAuthorization ? `${new Decimal(preview.snapshot.discountAuthorization.preapprovedPercent).toFixed(1)}% is the Approved Discount. Any amount above this is a Management Special Discount and requires Management approval.` : 'Applied before sales tax; subject to Management approval.'}</small>
                    {preview?.snapshot.discountAuthorization && input.discountMode!=='Pre-approved' && <Button variant="neutral" onClick={()=>update({discountMode:'Pre-approved',discountPercent:undefined,roundedTotal:undefined})}>Use Approved Discount</Button>}
                </label>
                <label className="discount-presentation-control">
                  <span>
                    <input type="checkbox" aria-label="Add discount to selling price" checked={!!input.includeDiscountInSellingPrice}
                      onChange={e=>update({includeDiscountInSellingPrice:e.target.checked})}
                      aria-describedby="discount-presentation-help"/>
                    Add discount to selling price
                  </span>
                  <small id="discount-presentation-help">Spread the total approved and special discount across eligible item prices. Solar panels, structure and earthing keep their standard prices. GST is recalculated and separate discount lines are removed.</small>
                </label>
                <label>
                  Commercial remarks (internal)
                  <input
                    value={input.remarks}
                    maxLength={2000}
                    onChange={(e) => update({ remarks: e.target.value })}
                  />
                </label>
              </div>
            </fieldset>
          </form>
          <details className="pz-form-section"><summary>Discount Approval Evidence{input.discountApprovalEvidence?.length?` · ${input.discountApprovalEvidence.length} attached`:''}</summary><DiscountApprovalEvidence session={session} files={input.discountApprovalEvidence??[]} onChange={files=>update({discountApprovalEvidence:files})}/></details>
          {!p&&<section className="detail-panel"><h3>Selling Prices Review</h3><p role="status">{input.boqRevisionId?'Loading selling prices…':'Select a BOQ to review selling prices.'}</p></section>}
          {p && (
            <section className="detail-panel">
              <h3>
                {sellingOnly?'Selling Prices Review':financialManager
                  ? "Internal commercial summary"
                  : "Non-BESS cost & selling review"}
              </h3>
              <p>Solution ID: <strong>{p.solutionId||'N/A'}</strong></p>
              {pricingUpdating&&<p role="status">Updating selling prices… Previous amounts remain visible until the update completes.</p>}
              {financialManager && p?.dealAccounting && (
                <p role="status">
                  {p.dealAccounting.note} Retained GST-equivalent: PKR{" "}
                  {money(p.dealAccounting.retainedGstEquivalent)}.
                </p>
              )}
              {!sellingOnly&&!financialManager && (
                <p>
                  BESS equipment costs and confidential profitability are
                  excluded. The selling totals below include the complete
                  quotation.
                </p>
              )}
              <div className="table-scroll">
                <table className={sellingOnly?"master-table commercial-price-table":"master-table"}>
                  {sellingOnly&&<colgroup>{[22,14,9,13,16,11,15].map((width,index)=><col key={index} style={{width:width+'%'}}/>)}</colgroup>}
                  <thead>
                    <tr>
                      {(sellingOnly?['Category','Selling price before discount','Discount (%)','Discount amount','Selling price after discount','Sales tax','Selling including tax']:[
                        "Category",
                        "Cost (PKR)",
                        "Markup %",
                        "Profit (PKR)",
                        "Selling before tax",
                        "Sales tax",
                        "Selling after tax",
                      ])
                        .filter(h=>sellingOnly?!['Cost (PKR)','Markup %','Profit (PKR)'].includes(h):financialManager||h!=='Profit (PKR)')
                        .map((h,index) => (
                          <th key={h} className={index?"numeric":undefined}>{h}</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.key}>
                        <td>{r.name}</td>
                        {!sellingOnly&&<><td className="numeric">{money(r.cost)}</td>
                        <td className="numeric">
                          {new Decimal(r.markup).toDecimalPlaces(2).toString()}%
                        </td></>}
                        {!sellingOnly&&financialManager && (
                          <td className="numeric">{money(r.profit)}</td>
                        )}
                        <td className="numeric">{money(r.beforeTax)}</td>
                        {sellingOnly&&<><td className="numeric">{new Decimal(r.beforeTax).gt(0)?new Decimal(discountReview!.rows.find(row=>row.key===r.key)!.discountAmount).div(r.beforeTax).mul(100).toFixed(1):'0.0'}%</td><td className="numeric">{money(discountReview!.rows.find(row=>row.key===r.key)!.discountAmount)}</td><td className="numeric">{money(discountReview!.rows.find(row=>row.key===r.key)!.sellingAfterDiscount)}</td></>}
                        <td className="numeric">{money(sellingOnly?discountReview!.rows.find(row=>row.key===r.key)!.discountedTax:r.tax)}</td>
                        <td className="numeric">{money(sellingOnly?discountReview!.rows.find(row=>row.key===r.key)!.discountedAfterTax:r.afterTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!sellingOnly&&p.policy && (
                <p>
                  Standard Commercial Policy v{p.policy.version} · Category
                  percentages in the summary are effective averages where a
                  display group contains different item markups.
                </p>
              )}
              {!sellingOnly&&financialManager && p.itemPricing && (
                <details>
                  <summary>Standard item selling prices</summary>
                  <div className="table-scroll">
                    <table className="master-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Category</th>
                          <th>Pre-tax cost</th>
                          <th>Standard markup</th>
                          <th>Selling before tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.itemPricing.map((l) => (
                          <tr key={l.key}>
                            <td>{l.description}</td>
                            <td>{l.category}</td>
                            <td>{money(l.cost)}</td>
                            <td>
                              {new Decimal(l.markup)
                                .toDecimalPlaces(2)
                                .toString()}
                              %
                            </td>
                            <td>{money(l.beforeTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              <div className="quote-totals commercial-aligned-totals">
                {financialManager && p?.dealAccounting && (
                  <p role="status">
                    {p.dealAccounting.note} Retained GST-equivalent: PKR{" "}
                    {money(p.dealAccounting.retainedGstEquivalent)}.
                  </p>
                )}
                {!sellingOnly&&!financialManager && (
                  <p>
                    <span>Visible Cost Subtotal — Excludes BESS Equipment</span>
                    <strong>PKR {money(visibleCost)}</strong>
                  </p>
                )}
                {!sellingOnly&&financialManager && (
                  <p>
                    <span>Approved BOQ cost</span>
                    <strong>PKR {money(p.cost)}</strong>
                  </p>
                )}
                <p>
                  <span>Selling before tax</span>
                  <strong>PKR {money(p.subtotal)}</strong>
                </p>
                <p>
                  <span>Sales tax before discount</span>
                  <strong>PKR {money(p.tax)}</strong>
                </p>
                <p className="net-total">
                  <span>Selling price including tax</span>
                  <strong>PKR {money(p.total)}</strong>
                </p>
                {new Decimal(p.discount).gt(0)&&<>
                  <p><span>{p.discountAuthorization?'Approved Discount':'Proposed discount'} {p.discountAuthorization?'':`(${new Decimal(p.input.discountPercent||'0').toFixed(1)}%)`}</span><strong>PKR {money(p.discountAuthorization?.approvedAppliedBeforeTax??p.discount)}</strong></p>
                  {p.discountAuthorization && new Decimal(p.discountAuthorization.managementSpecialBeforeTax).gt(0) && <p><span>Management Special Discount</span><strong>PKR {money(p.discountAuthorization.managementSpecialBeforeTax)}</strong></p>}
                  {new Decimal(p.tax).gt(discountReview!.tax)&&<p><span>Sales tax reduction from discount</span><strong>PKR {money(new Decimal(p.tax).sub(discountReview!.tax).toFixed(2))}</strong></p>}
                  <p className="net-total"><span>Total after discount including tax</span><strong>PKR {money(discountReview!.netTotal)}</strong></p>
                </>}
                {new Decimal(discountReview!.roundingAdjustment).isZero()?null:<p><span>Rounding adjustment</span><strong>PKR {money(discountReview!.roundingAdjustment)}</strong></p>}
                <label className="pz-rounded-total">Rounded Total (PKR)<input type="text" inputMode="decimal" value={(input.roundedTotal??'').split('.').map((part,index)=>index===0?part.replace(/\B(?=(\d{3})+(?!\d))/g, ','):part).join('.')} onChange={e=>{const field=e.currentTarget;const position=field.selectionStart??field.value.length;const significant=field.value.slice(0,position).replace(/,/g,'').length;roundTotal(field.value);requestAnimationFrame(()=>{let count=0,caret=0;while(caret<field.value.length&&count<significant){if(field.value[caret]!==',')count++;caret++;}field.setSelectionRange(caret,caret);});}} placeholder="Enter the final rounded total"/><small>Updates the discount percentage and amounts automatically.</small></label>
              </div>
              {!savedPrice ? (
                <button
                  className="primary"
                  disabled={busy||pricingUpdating}
                  onClick={() => void pricingSave()}
                >
                  Preview Quotation
                </button>
              ) : (
                <>
                  <p>{savedPrice.number} · Immutable saved pricing</p>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void prepareQuote()}
                  >
                    Prepare quotation
                  </button>
                </>
              )}
            </section>
          )}
          {session.user.role!=="Coordinator"&&<section className="detail-panel">
            <details>
              <summary>Saved pricing versions</summary>
              {prices.length ? (
                prices.map((r) => (
                  <button
                    key={r.id}
                    className="draft-button"
                    disabled={busy}
                    onClick={() => void selectPrice(r.id)}
                  >
                    {r.number} · PKR {money(r.total)}
                  </button>
                ))
              ) : (
                <p>No pricing saved yet.</p>
              )}
            </details>
          </section>}
        </>
      )}
      {!manager && section === "pricing" && (
        <p>
          Coordinators and management prepare commercial pricing. Saved customer
          quotations are available below.
        </p>
      )}
      {quoteInput && manager && (
        <>
          <div className="pz-action-row"><h2>Quotation Preview</h2><Button variant="secondary" onClick={()=>{setQuoteInput(undefined);setQuotePreview(undefined);setQuotePdfInput(undefined);setNotice('');}}>Back to Quotation Settings</Button></div>
          <p>
            {revisionInfo &&
              `${revisionInfo.origin} revision: ${revisionInfo.reason}`}
          </p>
          {revisionInfo && !revisionInfo.costing_change && (
            <Button variant="secondary"
              onClick={() =>
                onRevisionPricing?.(
                  savedPrice?.snapshot.input.boqRevisionId ?? input.boqRevisionId,
                  revisionInfo.id,
                )
              }
            >
              Edit revision margins / tax
            </Button>
          )}
          <form
            className="survey-form"
            onSubmit={(e) => {
              e.preventDefault();
              void calculateQuote();
            }}
          >
            <fieldset disabled={busy}>
              <legend>Customer quotation details</legend>
              <div className="survey-grid">
                <label>
                  Quoted date
                  <input
                    type="date"
                    required
                    value={quoteInput.quotedDate}
                    onChange={(e) =>
                      quoteChange({ quotedDate: e.target.value })
                    }
                  />
                </label>
                <label>
                  Validity
                  <input
                    required
                    maxLength={100}
                    value={quoteInput.validity}
                    onChange={(e) => quoteChange({ validity: e.target.value })}
                  />
                </label>
                <label>
                  Proposed by
                  <input
                    required
                    maxLength={100}
                    value={quoteInput.proposedBy}
                    onChange={(e) =>
                      quoteChange({ proposedBy: e.target.value })
                    }
                  />
                </label>
              </div>
              <h3>Customer-facing descriptions</h3>
              <p>
                These use the quotation reference wording. Detailed BOQ
                specifications are not copied here.
              </p>
              {quoteInput.descriptions?.map((d, i) => (
                <label className="source-label quote-description" key={i}>
                  Row {i + 1}
                  <textarea
                    required
                    maxLength={1500}
                    value={d}
                    onChange={(e) =>
                      quoteChange({
                        descriptions: quoteInput.descriptions!.map((v, j) =>
                          j === i ? e.target.value : v,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              {!sellingOnly && !savedPrice?.snapshot.policy &&
                savedPrice?.snapshot.input.presentation === "Full Breakup" &&
                !savedPrice.snapshot.rows.some(
                  (r: any) => r.key === "additional",
                ) &&
                (!revisionInfo ||
                  (!revisionInfo.costing_change &&
                    quoteInput.additionalItem)) && (
                  <fieldset>
                    <legend>Optional additional item — row 17</legend>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!!revisionInfo}
                        checked={!!quoteInput.additionalItem}
                        onChange={(e) =>
                          quoteChange({
                            additionalItem: e.target.checked
                              ? {
                                  description: "Additional item",
                                  cost: "0",
                                  markup: "0",
                                  taxRate: "18",
                                }
                              : undefined,
                          })
                        }
                      />
                      Include an additional item
                    </label>
                    {quoteInput.additionalItem && (
                      <div className="form-grid">
                        <label>
                          Description
                          <input
                            readOnly={!!revisionInfo}
                            required
                            maxLength={1500}
                            value={quoteInput.additionalItem.description}
                            onChange={(e) =>
                              quoteChange({
                                additionalItem: {
                                  ...quoteInput.additionalItem!,
                                  description: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Cost (PKR)
                          <input
                            readOnly={!!revisionInfo}
                            required
                            type="number"
                            min="0"
                            step="0.01"
                            value={quoteInput.additionalItem.cost}
                            onChange={(e) =>
                              quoteChange({
                                additionalItem: {
                                  ...quoteInput.additionalItem!,
                                  cost: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Markup on cost %
                          <input
                            required
                            type="number"
                            min="0"
                            step="0.0001"
                            value={quoteInput.additionalItem.markup}
                            onChange={(e) =>
                              quoteChange({
                                additionalItem: {
                                  ...quoteInput.additionalItem!,
                                  markup: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Tax category
                          <select
                            aria-label="Tax category"
                            value={quoteInput.additionalItem.taxRate}
                            onChange={(e) =>
                              quoteChange({
                                additionalItem: {
                                  ...quoteInput.additionalItem!,
                                  taxRate: e.target.value as "0" | "10" | "18",
                                },
                              })
                            }
                          >
                            <option value="18">Other items — 18%</option>
                            <option value="10">Solar — 10%</option>
                            <option value="0">No tax — 0%</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </fieldset>
                )}
            </fieldset>
            <Button
              variant="secondary"
              type="submit"
              loading={busy}
              loadingLabel="Preparing preview…"
            >
              Preview quotation
            </Button>
            {quoteInput.revisionRequestId&&<div className="pz-send-action"><Button variant="primary" loading={busy} loadingLabel="Saving revision…" onClick={()=>void saveQuote(false)}>Save Revision</Button>{error&&<p className="form-error" role="alert">{error}</p>}</div>}
          </form>
        </>
      )}
      {quotePreview && !savedQuote && (
        <>
          {!financialManager && (
            <p>
              {quotePreview.snapshot.discountAuthorization && !quotePreview.snapshot.discountAuthorization.requiresManagementApproval ? 'This discount is within Atif’s pre-approved allowance.' : 'This discount exceeds the pre-approved allowance and requires Management approval.'}
            </p>
          )}
          {!quotePreview.fingerprint && <p role="status">Quotation details changed. Press Preview Quotation to refresh the document.</p>}
          {quotePreview.fingerprint&&<QuotationView
            refreshKey={quotePreview.refreshVersion}
            snapshot={quotePreview.snapshot}
            discount={quoteInput?.discount}
            onDiscount={manager ? changeQuotationDiscount : undefined}
            draftInput={quotePdfInput}
            csrf={session.csrfToken}
          />}
          {!quotePreview.fingerprint && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void calculateQuote()}
            >
              Confirm quotation totals
            </button>
          )}
          <RevisionComparison
            snapshot={quotePreview.snapshot}
            acknowledged={priceChangeAcknowledged}
            onAcknowledge={setPriceChangeAcknowledged}
          />
          {quoteInput?.revisionRequestId?<p>Save Revision to review the saved quotation, then send that saved version to Management.</p>:<p>{quotePreview.snapshot.discountAuthorization && !quotePreview.snapshot.discountAuthorization.requiresManagementApproval && !(quotePreview.snapshot as QuotationSnapshot & {revision?:unknown}).revision && !quoteInput?.additionalItem ? 'Download the preview or approve it within the pre-approved discount allowance.' : 'Download the preview or send the reviewed quotation to Management for approval.'}</p>}
          <div className="pz-action-row">
            <Button
              variant="secondary"
              loading={busy}
              disabled={
                !quotePreview.fingerprint ||
                (hasRevisionPriceChange(quotePreview.snapshot) &&
                  !priceChangeAcknowledged)
              }
              onClick={()=>void action(async()=>{const result=await api<{url:string}>('/commercial/quotations/preview-download',{body:quotePdfInput,csrf:session.csrfToken});const link=document.createElement('a');link.href=result.url;document.body.appendChild(link);link.click();link.remove();})}
            >
              Download Preview
            </Button>
            {!quoteInput?.revisionRequestId&&<div className="pz-send-action">
            <Button
              variant="primary"
              loading={busy}
              disabled={
                !quotePreview.fingerprint ||
                (hasRevisionPriceChange(quotePreview.snapshot) &&
                  !priceChangeAcknowledged)
              }
              onClick={() => void saveQuote(true)}
            >
              {quotePreview.snapshot.discountAuthorization && !quotePreview.snapshot.discountAuthorization.requiresManagementApproval && !(quotePreview.snapshot as QuotationSnapshot & {revision?:unknown}).revision && !quoteInput?.additionalItem ? 'Approve Quotation' : 'Send to Management'}
            </Button>
              {sendError&&<p className="form-error" role="alert">{sendError}</p>}
            </div>}
          </div>
        </>
      )}
      {savedQuote && (
        <>
          {savedQuote.snapshot.revision&&!savedQuote.workflow_status&&<p role="status">Revision saved: {savedQuote.number}. Review this saved quotation before sending it to Management.</p>}
          {savedQuote.workflow_status==='Approved'&&<><h3>Submitted Pricing Summary</h3><RevisionPricingSummary session={session} source={savedQuote}/></>}
          <QuotationWorkflow
            key={savedQuote.id}
            session={session}
            quotation={savedQuote}
            onChange={next=>{setSavedQuote(next);if(onQuotationSent&&next.workflow_status==='Submitted'&&savedQuote.workflow_status!=='Submitted')onQuotationSent();}}
            renderPreview={(snapshot, discount, onDiscount) => (
              <QuotationView
                snapshot={snapshot}
                number={savedQuote.number}
                pdfUrl={`/api/commercial/quotations/${savedQuote.id}/quotation.pdf`}
                discount={discount}
                onDiscount={onDiscount}
              />
            )}
          />
          {manager && (
            <a
              className="quote-format-download"
              href={`/api/commercial/quotations/${savedQuote.id}/comparison.pdf`}
              download
            >
              Download all six quotation formats (review PDF)
            </a>
          )}
          {savedQuote.snapshot.revision && (
            <p>
              {savedQuote.snapshot.revision.origin} revision ·{" "}
              {savedQuote.snapshot.revision.reason} · Previous quotation:{" "}
              {savedQuote.snapshot.revision.sourceQuotation} · Costing:{" "}
              {savedQuote.snapshot.boqNumber}
            </p>
          )}
          {(manager || savedQuote.workflow_status!=='Submitted') &&
            <button
              disabled={busy}
              onClick={() => {
                setRevisionDialog(true);
                setRevisionReason(savedQuote.workflow_notes ?? "");
                setCostingChoice("");
              }}
            >
              Create new quotation version
            </button>
          }
          {revisionDialog && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  if (
                    !(await confirmRevision(
                      "Start quotation revision",
                      "A separate revision will be created. The existing approved costing and quotation remain unchanged.",
                    ))
                  )
                    return;
                  const r = await api<any>("/commercial/revision-requests", {
                    body: {
                      sourceQuotationId: savedQuote.id,
                      origin: revisionOrigin,
                      costingChange: costingChoice === "yes",
                      reason: revisionReason,
                      requestedBy: revisionRequester,
                      requestKey: crypto.randomUUID(),
                    },
                    csrf: session.csrfToken,
                  });
                  setRevisionInfo(r);
                  setRevisionDialog(false);
                  if (r.draft_id) {
                    onRevisionDraft?.(r.draft_id);
                    return;
                  }
                  const copy = await api<QuotationInput>(
                    `/commercial/quotations/${savedQuote.id}/copy`,
                  );
                  await prepareQuote({ ...copy, revisionRequestId: r.id });
                });
              }}
              className="detail-panel revision-request-form"
            >
              <h3>Revision request</h3>
              <RevisionReasonFields origin={revisionOrigin} onOrigin={setRevisionOrigin} requester={revisionRequester} onRequester={setRevisionRequester} reason={revisionReason} onReason={setRevisionReason} costingChoice={costingChoice} onCostingChoice={setCostingChoice} allowCommercial={manager}/>
              <p>
                Commercial revisions retain the original costing. Costing
                changes require a revised BOQ and approval before a new
                quotation can be saved.
              </p>
              <button className="primary" disabled={busy}>
                Start revision
              </button>
            </form>
          )}
        </>
      )}
      {session.user.role!=="Coordinator"&&!input.revisionRequestId&&!revisionInfo&&!initialFrameworkInput&&!savedQuote?.snapshot?.revision&&!(quotePreview?.snapshot as (QuotationSnapshot & {revision?:unknown}) | undefined)?.revision&&<section className="detail-panel">
        <h3>Revision requests</h3>
        {revisionRequests.length ? (
          revisionRequests.map((r) => (
            <div key={r.id}>
              <p>
                {r.origin} · {r.source_number} · {r.reason} ·{" "}
                {r.completed_quotation_id
                  ? "Completed"
                  : r.costing_change
                    ? r.approved_revision_id
                      ? "Costing approved"
                      : "BOQ revision awaiting preparation / approval"
                    : "Commercial revision pending"}
              </p>
              {!r.completed_quotation_id && (
                <button
                  disabled={
                    busy ||
                    (r.costing_change && !r.approved_revision_id
                      ? r.created_by !== session.user.id
                      : !manager)
                  }
                  onClick={() => {
                    if (r.costing_change && !r.approved_revision_id) {
                      onRevisionDraft?.(r.draft_id);
                    } else if (manager) {
                      onRevisionPricing?.(
                        r.approved_revision_id ?? r.source_boq_id,
                        r.id,
                      );
                    }
                  }}
                >
                  Resume revision
                </button>
              )}
            </div>
          ))
        ) : (
          <p>No revision requests yet.</p>
        )}
        <h3>Quotation history</h3>
        {quotes.length ? (
          quotes.map((q) => (
            <button
              key={q.id}
              disabled={busy}
              className="draft-button"
              onClick={() => void openQuote(q.id)}
            >
              {q.number} · {q.customer} · {q.site}
            </button>
          ))
        ) : (
          <p>No quotations saved yet.</p>
        )}
      </section>}
    </section>
  );
}
