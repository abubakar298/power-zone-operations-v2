import { QuotationWorkflow } from "./QuotationWorkflow.js";
import { confirmTransition } from "../confirm.js";
import { createPortal } from "react-dom";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
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
const money = (v: string) =>
  new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
const defaults = (name: string, id = ""): PricingInput => ({
  boqRevisionId: id,
  presentation: "No Breakup",
  taxMode: "Show Sales Tax Separately",
  markups: {
    solar: "20",
    structure: "20",
    bess: "15",
    earthing: "20",
    balance: "20",
    rest: "20",
  },
  preparedBy: name,
  remarks: "",
});
function editablePricing(p: PricingSnapshot): PricingInput {
  const markups = { ...p.input.markups };
  for (const r of p.rows) if (r.key !== "additional") markups[r.key] = r.markup;
  return { ...p.input, markups };
}
export function QuotationView({
  snapshot: s,
  number,
  pdfUrl,
  discount,
  onDiscount,
  draftInput,
  csrf,
}: {
  snapshot: QuotationSnapshot;
  number?: string;
  pdfUrl?: string;
  discount?: string;
  onDiscount?: (value: string) => void;
  draftInput?: QuotationInput;
  csrf?: string;
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
        const response = await fetch(
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
        const pdf = await import("pdfjs-dist");
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
  }, [pdfUrl, serialized, csrf]);
  return (
    <section className="boq-costing quotation-preview">
      <div className="panel-heading">
        <h2>{number ?? "Quotation preview"}</h2>
        {pdfUrl && (
          <a className="dark-button" href={pdfUrl} download>
            Download quotation PDF
          </a>
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
  section = "pricing",
  onRevisionDraft,
  onRevisionPricing,
  initialRequestId,
  initialQuotationId,
  initialPricingId,
}: {
  session: Session;
  initialRevisionId?: string;
  section?: "pricing" | "quotes";
  onRevisionDraft?: (id: string) => void;
  onRevisionPricing?: (id: string, requestId: string) => void;
  initialRequestId?: string;
  initialQuotationId?: string;
  initialPricingId?: string;
}) {
  const manager = ["Admin", "Management", "Coordinator"].includes(
    session.user.role,
  );
  const [boqs, setBoqs] = useState<any[]>([]),
    [prices, setPrices] = useState<any[]>([]),
    [quotes, setQuotes] = useState<any[]>([]),
    [input, setInput] = useState<PricingInput>(
      defaults(session.user.displayName, initialRevisionId),
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
    }>(),
    [savedQuote, setSavedQuote] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [key, setKey] = useState(crypto.randomUUID());
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
  async function load() {
    const [b, q] = await Promise.all([
      api<{ boqs: any[] }>("/boqs"),
      api<{ quotations: any[] }>("/commercial/quotations"),
    ]);
    setBoqs(b.boqs);
    setQuotes(q.quotations);
    setRevisionRequests(
      (await api<{ requests: any[] }>("/commercial/revision-requests"))
        .requests,
    );
    if (manager)
      setPrices((await api<{ pricing: any[] }>("/commercial/pricing")).pricing);
  }
  useEffect(() => {
    void load().catch(fail);
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
    const a = await api<any>(`/boqs/${id}/instructions`);
    if (a) {
      setInput((old) =>
        old.boqRevisionId === id
          ? {
              ...old,
              presentation: a.instructions.presentation,
              taxMode: a.instructions.taxMode,
              markups: a.instructions.markups,
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
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function update(p: Partial<PricingInput>) {
    setInput({ ...input, ...p });
    setPreview(undefined);
    setSavedPrice(undefined);
    setQuoteInput(undefined);
    setQuotePreview(undefined);
    setSavedQuote(undefined);
    setKey(crypto.randomUUID());
    setNotice("");
  }
  async function pricingPreview() {
    await action(async () => {
      setPreview(
        await api("/commercial/pricing/preview", {
          body: input,
          csrf: session.csrfToken,
        }),
      );
      setNotice(
        "Review the internal pricing, then save an immutable pricing version.",
      );
    });
  }
  async function pricingSave() {
    if (!preview) return;
    if (
      !confirmTransition(
        "Save pricing version",
        "This preserves the selling prices and margins used to prepare the quotation.",
      )
    )
      return;
    await action(async () => {
      const p = await api<any>("/commercial/pricing", {
        body: { ...input, fingerprint: preview.fingerprint, requestKey: key },
        csrf: session.csrfToken,
      });
      setSavedPrice(p);
      await load();
      setNotice(
        `${p.number} saved. You can now prepare its customer quotation.`,
      );
    });
  }
  async function selectPrice(id: string) {
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
      const data: QuotationInput = copy ?? {
        pricingId: savedPrice.id,
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
      if (copy) {
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
      const result = await api<{
        snapshot: QuotationSnapshot;
        fingerprint: string;
      }>("/commercial/quotations/preview", {
        body: data,
        csrf: session.csrfToken,
      });
      setQuoteInput({
        ...data,
        discount: result.snapshot.input.discount,
        descriptions: result.snapshot.lines
          .slice(0, result.snapshot.scopeCount)
          .map((l) => l.description),
      });
      setQuotePreview(result);
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
      if (sequence === previewSequence.current) setQuotePreview(result);
    });
  }
  async function saveQuote(submit = false) {
    if (!quoteInput || !quotePreview) return;
    if (
      !confirmTransition(
        submit
          ? "Save and send quotation for approval"
          : "Save quotation version",
        "This preserves the quotation prices, discount and terms as an immutable version.",
      )
    )
      return;
    await action(async () => {
      const q = await api<any>("/commercial/quotations", {
        body: {
          ...quoteInput,
          discount: quoteInput.discount?.trim() || "0",
          fingerprint: quotePreview.fingerprint,
          requestKey: key,
        },
        csrf: session.csrfToken,
      });
      setSavedQuote(q);
      setQuoteInput(undefined);
      if (submit) {
        await api("/coordinator/events", {
          body: { quotationId: q.id, kind: "Submitted", notes: "" },
          csrf: session.csrfToken,
        });
        setSavedQuote(await api(`/commercial/quotations/${q.id}`));
      }
      await load();
      setNotice(
        `${q.number} saved. Earlier quotation versions remain unchanged.`,
      );
    });
  }
  async function openQuote(id: string) {
    await action(async () => {
      setSavedQuote(await api(`/commercial/quotations/${id}`));
      setQuoteInput(undefined);
      setQuotePreview(undefined);
    });
  }
  const previewSequence = useRef(0);
  const quoteFields = quoteInput
    ? JSON.stringify({ ...quoteInput, discount: undefined })
    : "";
  useEffect(() => {
    if (!quoteInput || !quotePreview) return;
    const sequence = ++previewSequence.current;
    const timer = setTimeout(() => {
      void api<{ snapshot: QuotationSnapshot; fingerprint: string }>(
        "/commercial/quotations/preview",
        {
          body: { ...quoteInput, discount: quoteInput.discount?.trim() || "0" },
          csrf: session.csrfToken,
        },
      )
        .then((result) => {
          if (sequence === previewSequence.current) {
            setQuotePreview(result);
            setError("");
          }
        })
        .catch((e) => {
          if (sequence === previewSequence.current) fail(e);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      ++previewSequence.current;
    };
  }, [quoteFields]);
  function quoteChange(p: Partial<QuotationInput>) {
    ++previewSequence.current;
    setQuoteInput({ ...quoteInput!, ...p });
    setQuotePreview((old) => (old ? { ...old, fingerprint: "" } : old));
    setSavedQuote(undefined);
    setKey(crypto.randomUUID());
  }
  function changeQuotationDiscount(value: string) {
    ++previewSequence.current;
    if (!quoteInput || !quotePreview) return;
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
  return (
    <section className="commercial-section">
      <p>
        Commercial pricing and quotations use the exact approved BOQ revision.
        Saved versions retain their original inputs and amounts.
      </p>
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
      {section === "pricing" && manager && (
        <>
          <form
            className="survey-form"
            onSubmit={(e) => {
              e.preventDefault();
              void pricingPreview();
            }}
          >
            <fieldset disabled={busy || revisionLoading}>
              <legend>Approved BOQ & commercial settings</legend>
              <div className="survey-grid">
                <label>
                  Approved BOQ revision
                  <select
                    aria-label="Approved BOQ revision"
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
                        {b.number} · {b.site} · PKR {money(b.total)}
                      </option>
                    ))}
                  </select>
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
                    <option>Basic Breakup</option>
                    <option>Full Breakup</option>
                  </select>
                </label>
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
                {[
                  ["solar", "Solar"],
                  ["structure", "Structure"],
                  ["bess", "BESS"],
                  ["earthing", "Earthing Bores"],
                  ["balance", "BOS (shared)"],
                ].map(([k, label]) => (
                  <label key={k}>
                    {label} Markup %
                    <input
                      aria-label={`${label} Markup %`}
                      type="number"
                      min="0"
                      max="999999"
                      step="0.0001"
                      required
                      value={input.markups[k as keyof PricingInput["markups"]]}
                      onChange={(e) =>
                        update({
                          markups: { ...input.markups, [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
                {(input.additionalMarkup !== undefined ||
                  p?.rows.some((r) => r.key === "additional")) && (
                  <label>
                    Additional item markup %
                    <input
                      aria-label="Additional item markup %"
                      type="number"
                      min="0"
                      step="0.0001"
                      value={input.additionalMarkup ?? input.markups.balance}
                      onChange={(e) =>
                        update({ additionalMarkup: e.target.value })
                      }
                    />
                  </label>
                )}
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
                  Prepared by
                  <input
                    value={input.preparedBy}
                    required
                    maxLength={100}
                    onChange={(e) => update({ preparedBy: e.target.value })}
                  />
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
              <p className="muted-label">
                Markup is added to cost: 100 cost + 33% markup = 133 selling
                before tax. Starting percentages are editable.
              </p>
            </fieldset>
            <button className="primary" disabled={busy} type="submit">
              Calculate selling price
            </button>
          </form>
          {p && (
            <section className="detail-panel">
              <h3>Internal commercial summary</h3>
              <div className="table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      {[
                        "Category",
                        "Cost (PKR)",
                        "Markup %",
                        "Profit (PKR)",
                        "Selling before tax",
                        "Sales tax",
                        "Selling after tax",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((r) => (
                      <tr key={r.key}>
                        <td>{r.name}</td>
                        <td className="numeric">{money(r.cost)}</td>
                        <td className="numeric">{r.markup}%</td>
                        <td className="numeric">{money(r.profit)}</td>
                        <td className="numeric">{money(r.beforeTax)}</td>
                        <td className="numeric">{money(r.tax)}</td>
                        <td className="numeric">{money(r.afterTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="quote-totals">
                <p>
                  <span>Approved BOQ cost</span>
                  <strong>PKR {money(p.cost)}</strong>
                </p>
                <p>
                  <span>Selling before tax</span>
                  <strong>PKR {money(p.subtotal)}</strong>
                </p>
                <p>
                  <span>Sales tax (internal)</span>
                  <strong>PKR {money(p.tax)}</strong>
                </p>
                <p className="net-total">
                  <span>Selling price including tax</span>
                  <strong>PKR {money(p.total)}</strong>
                </p>
              </div>
              {!savedPrice ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void pricingSave()}
                >
                  Save pricing version
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
          <section className="detail-panel">
            <h3>Saved pricing versions</h3>
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
          </section>
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
          <p>
            {revisionInfo &&
              `${revisionInfo.origin} revision: ${revisionInfo.reason}`}
          </p>
          {revisionInfo && !revisionInfo.costing_change && (
            <button
              onClick={() =>
                onRevisionPricing?.(
                  savedPrice.snapshot.input.boqRevisionId,
                  revisionInfo.id,
                )
              }
            >
              Edit revision margins / tax
            </button>
          )}
          <form
            className="survey-form"
            onSubmit={(e) => {
              e.preventDefault();
              void calculateQuote();
            }}
          >
            <fieldset>
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
                    readOnly={!!revisionInfo && !revisionInfo.costing_change}
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
              {savedPrice?.snapshot.input.presentation === "Full Breakup" &&
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
            <button className="primary" disabled={busy}>
              Preview quotation
            </button>
          </form>
        </>
      )}
      {quotePreview && !savedQuote && (
        <>
          <QuotationView
            snapshot={quotePreview.snapshot}
            discount={quoteInput?.discount}
            onDiscount={manager ? changeQuotationDiscount : undefined}
            draftInput={quoteInput}
            csrf={session.csrfToken}
          />
          {!quotePreview.fingerprint && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void calculateQuote()}
            >
              Confirm quotation totals
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !quotePreview.fingerprint}
            onClick={() => void saveQuote()}
          >
            Save quotation version
          </button>
          <button
            className="primary"
            disabled={busy || !quotePreview.fingerprint}
            onClick={() => void saveQuote(true)}
          >
            Save and send for approval
          </button>
        </>
      )}
      {savedQuote && (
        <>
          <QuotationWorkflow
            key={savedQuote.id}
            session={session}
            quotation={savedQuote}
            onChange={setSavedQuote}
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
          {
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
                if (
                  !confirmTransition(
                    "Start quotation revision",
                    "A separate revision will be created. The existing approved costing and quotation remain unchanged.",
                  )
                )
                  return;
                void action(async () => {
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
              <label>
                Requested by
                <select
                  aria-label="Revision source"
                  value={revisionOrigin}
                  onChange={(e) => setRevisionOrigin(e.target.value)}
                >
                  <option>Internal management</option>
                  <option>Customer</option>
                </select>
              </label>
              <label>
                Requester name
                <input
                  required
                  value={revisionRequester}
                  onChange={(e) => setRevisionRequester(e.target.value)}
                />
              </label>
              <label>
                Reason
                <textarea
                  aria-label="Quotation revision reason"
                  required
                  maxLength={2000}
                  value={revisionReason}
                  onChange={(e) => setRevisionReason(e.target.value)}
                />
              </label>
              <label>
                Does this require costing or technical scope changes?
                <select
                  aria-label="Requires costing change"
                  required
                  value={costingChoice}
                  onChange={(e) => setCostingChoice(e.target.value)}
                >
                  <option value="">Choose revision route</option>
                  {manager && (
                    <option value="no">
                      No — margins, tax, discount or commercial details only
                    </option>
                  )}
                  <option value="yes">
                    Yes — quantities, technical specifications or additional
                    scope
                  </option>
                </select>
              </label>
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
      <section className="detail-panel">
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
      </section>
    </section>
  );
}
