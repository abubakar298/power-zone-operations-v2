import { useEffect, useState } from "react";
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
    solar: "5",
    structure: "7",
    bess: "15",
    earthing: "5",
    balance: "25",
    rest: "20",
  },
  discount: "0",
  preparedBy: name,
  remarks: "",
});
export function QuotationView({
  snapshot: s,
  number,
  pdfUrl,
}: {
  snapshot: QuotationSnapshot;
  number?: string;
  pdfUrl?: string;
}) {
  const amounts = s.presentation === "Basic Breakup";
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
      <p className="eyebrow">POWER ZONE ENGINEERING & SERVICES (PVT) LIMITED</p>
      <div className="quote-metadata">
        <p>
          <strong>Customer</strong> {s.customer.name}
        </p>
        <p>
          <strong>Quoted date</strong> {s.input.quotedDate}
        </p>
        <p>
          <strong>Site</strong> {s.siteName} · {s.siteCode}
        </p>
        <p>
          <strong>Proposed by</strong> {s.input.proposedBy}
        </p>
        <p>
          <strong>BOQ revision</strong> {s.boqNumber}
        </p>
        <p>
          <strong>Validity</strong> {s.input.validity}
        </p>
      </div>
      <p>{s.subject}</p>
      <p>Solution ID: {s.solutionId} · Security Level: Confidential</p>
      <div className="table-scroll">
        <table className="master-table quotation-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Product / Service Description</th>
              <th>UOM</th>
              <th className="numeric">Qty</th>
              {amounts && <th className="numeric">Amount (PKR)</th>}
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{l.description}</td>
                <td>{l.unit}</td>
                <td className="numeric">
                  {new Intl.NumberFormat("en-PK", {
                    maximumFractionDigits: 4,
                  }).format(Number(l.qty))}
                </td>
                {amounts && l.amount && (
                  <td rowSpan={l.span} className="numeric">
                    {money(l.amount)}
                    {(l.span ?? 1) > 1 && (
                      <small className="merged-amount">
                        Combined {l.group === "bess" ? "BESS" : "Balance / EPC"}
                      </small>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="quote-totals">
        {s.footer.map((r, i) => (
          <p
            key={r.label}
            className={i === s.footer.length - 1 ? "net-total" : ""}
          >
            <span>{r.label}</span>
            <strong>PKR {money(r.amount)}</strong>
          </p>
        ))}
      </div>
      <h3>Notes</h3>
      <ol>
        {s.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ol>
      <h3>Terms and conditions</h3>
      <ol>
        {s.terms.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      {!number && (
        <p className="muted-label">
          Draft preview. No quotation number has been issued.
        </p>
      )}
    </section>
  );
}
export function Commercial({
  session,
  initialRevisionId,
  section = "pricing",
}: {
  session: Session;
  initialRevisionId?: string;
  section?: "pricing" | "quotes";
}) {
  const manager = ["Admin", "Management"].includes(session.user.role);
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
  async function load() {
    const [b, q] = await Promise.all([
      api<{ boqs: any[] }>("/boqs"),
      api<{ quotations: any[] }>("/commercial/quotations"),
    ]);
    setBoqs(b.boqs);
    setQuotes(q.quotations);
    if (manager)
      setPrices((await api<{ pricing: any[] }>("/commercial/pricing")).pricing);
  }
  useEffect(() => {
    void load().catch(fail);
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
      setInput(p.snapshot.input);
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
        quotedDate: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Karachi",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        validity: "7 Days",
        proposedBy: session.user.displayName,
      };
      const result = await api<{
        snapshot: QuotationSnapshot;
        fingerprint: string;
      }>("/commercial/quotations/preview", {
        body: data,
        csrf: session.csrfToken,
      });
      setQuoteInput({
        ...data,
        descriptions: result.snapshot.lines.map((l) => l.description),
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
    await action(async () => {
      setQuotePreview(
        await api("/commercial/quotations/preview", {
          body: quoteInput,
          csrf: session.csrfToken,
        }),
      );
    });
  }
  async function saveQuote() {
    if (!quoteInput || !quotePreview) return;
    await action(async () => {
      const q = await api<any>("/commercial/quotations", {
        body: {
          ...quoteInput,
          fingerprint: quotePreview.fingerprint,
          requestKey: key,
        },
        csrf: session.csrfToken,
      });
      setSavedQuote(q);
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
  function quoteChange(p: Partial<QuotationInput>) {
    setQuoteInput({ ...quoteInput!, ...p });
    setQuotePreview(undefined);
    setSavedQuote(undefined);
    setKey(crypto.randomUUID());
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
            <fieldset>
              <legend>Approved BOQ & commercial settings</legend>
              <div className="survey-grid">
                <label>
                  Approved BOQ revision
                  <select
                    aria-label="Approved BOQ revision"
                    value={input.boqRevisionId}
                    onChange={(e) => update({ boqRevisionId: e.target.value })}
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
                    value={input.presentation}
                    onChange={(e) =>
                      update({
                        presentation: e.target
                          .value as PricingInput["presentation"],
                        markups: {
                          ...input.markups,
                          bess:
                            e.target.value === "Basic Breakup" ? "33" : "15",
                        },
                      })
                    }
                  >
                    <option>No Breakup</option>
                    <option>Basic Breakup</option>
                  </select>
                </label>
                <label>
                  Tax presentation
                  <select
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
                {(input.presentation === "No Breakup"
                  ? [
                      ["bess", "BESS"],
                      ["rest", "Everything Else"],
                    ]
                  : [
                      ["solar", "Solar"],
                      ["structure", "Structure"],
                      ["bess", "BESS"],
                      ["earthing", "Earthing Bores"],
                      ["balance", "Balance / Everything Else"],
                    ]
                ).map(([k, label]) => (
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
                <label>
                  Special Discount (PKR)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={input.discount}
                    onChange={(e) => update({ discount: e.target.value })}
                  />
                </label>
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
                <p>
                  <span>Special Discount</span>
                  <strong>PKR {money(p.discount)}</strong>
                </p>
                <p className="net-total">
                  <span>Net quoted price</span>
                  <strong>PKR {money(p.netTotal)}</strong>
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
          Admin and Management prepare commercial pricing. Saved customer
          quotations are available below.
        </p>
      )}
      {quoteInput && manager && (
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
                  onChange={(e) => quoteChange({ quotedDate: e.target.value })}
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
                  onChange={(e) => quoteChange({ proposedBy: e.target.value })}
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
          </fieldset>
          <button className="primary" disabled={busy}>
            Preview quotation
          </button>
        </form>
      )}
      {quotePreview && !savedQuote && (
        <>
          <QuotationView snapshot={quotePreview.snapshot} />
          <button
            className="primary"
            disabled={busy}
            onClick={() => void saveQuote()}
          >
            Save quotation version
          </button>
        </>
      )}
      {savedQuote && (
        <>
          <QuotationView
            snapshot={savedQuote.snapshot}
            number={savedQuote.number}
            pdfUrl={`/api/commercial/quotations/${savedQuote.id}/quotation.pdf`}
          />
          {manager && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const copy = await api<QuotationInput>(
                    `/commercial/quotations/${savedQuote.id}/copy`,
                  );
                  await prepareQuote(copy);
                })
              }
            >
              Create new quotation version
            </button>
          )}
        </>
      )}
      <section className="detail-panel">
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
