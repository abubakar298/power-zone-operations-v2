import { money } from "../numbers.js";
import { ExternalApproval } from "../components/ExternalApproval.js";
import { SharePdf } from "../components/SharePdf.js";
import { Operations } from "./Operations.js";
import { confirmTransition } from "../confirm.js";
import { quotationTypeLabel } from "../../server/orders/sale-type.js";
import { ipoPresentation } from "../../server/orders/presentation.js";
import { useEffect, useState, useRef } from "react";
import { api, type Session } from "../api.js";
import { orderSchema, type OrderInput } from "../../server/orders/schema.js";

import { extractText } from "../ocr.js";
import { poSuggestions } from "../../server/orders/po-extraction.js";

const fields: [keyof OrderInput, string][] = [
  ["poNumber", "Customer PO reference"],
  ["orderDate", "Order date"],
  ["invoiceCompany", "Customer / company name on invoice"],
  ["salesPerson", "Sales person"],
  ["customerNtn", "Customer NTN"],
  ["customerStrn", "Customer STRN"],
  ["contactPerson", "Customer contact person"],
  ["designation", "Designation"],
  ["phone", "Customer contact number"],
  ["email", "Customer email"],
  ["billingAddress", "Billing address"],
  ["paymentContact", "Person responsible for payment"],
  ["paymentPhone", "Payment contact number"],
  ["paymentMode", "Payment mode"],
  ["salesSource", "Sales source"],
  ["remarks", "Remarks"],
  ["evidenceNotes", "Approval evidence / verbal confirmation details"],
];
export function Orders({
  session,
  onOperations,
  initialQuotationId,
  initialSubmissionId,
  initialIpoId,
}: {
  session: Session;
  onOperations?: (id: string) => void;
  initialQuotationId?: string;
  initialSubmissionId?: string;
  initialIpoId?: string;
}) {
  const [quotes, setQuotes] = useState<any[]>([]),
    [orders, setOrders] = useState<any[]>([]),
    [input, setInput] = useState<Partial<OrderInput>>({
      orderDate: new Date().toLocaleDateString("en-CA"),
      entryVersion: 2,
    }),
    [accepted, setAccepted] = useState(false),
    [preview, setPreview] = useState<any>(),
    [saved, setSaved] = useState<any>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [document, setDocument] = useState<any>();
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [submissions, setSubmissions] = useState<any[]>([]),
    [review, setReview] = useState<any>();
  const [customerName, setCustomerName] = useState("");
  const [selectedType, setSelectedType] = useState<any>();
  const [extraction, setExtraction] = useState("");
  const selection = useRef(0);
  const manager = ["Admin", "Management"].includes(session.user.role);
  async function load() {
    const [q, o, s] = await Promise.all([
      api<any>("/commercial/quotations"),
      api<any>("/orders"),
      api<any>("/orders/submissions"),
    ]);
    setQuotes(q.quotations);
    setOrders(o.orders);
    setSubmissions(s.submissions);
    if (initialSubmissionId)
      setReview(s.submissions.find((v: any) => v.id === initialSubmissionId));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    if (initialIpoId)
      void api<any>(`/orders/${initialIpoId}`)
        .then(setSaved)
        .catch((e) => setError(e.message));
    if (initialQuotationId)
      void choose(initialQuotationId).catch((e) => setError(e.message));
  }, []);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  function change(field: keyof OrderInput, value: string) {
    setInput((v) => ({ ...v, [field]: value }));
    setPreview(undefined);
    setSaved(undefined);
    setReview(undefined);
    setKey(crypto.randomUUID());
  }
  async function choose(id: string) {
    const token = ++selection.current;
    setInput({
      quotationId: id,
      entryVersion: 2,
      orderDate: new Date().toLocaleDateString("en-CA"),
    });
    setAccepted(false);
    setDocument(undefined);
    setExtraction("");
    setCustomerName("");
    setPreview(undefined);
    setSaved(undefined);
    setReview(undefined);
    setKey(crypto.randomUUID());
    if (!id) return;
    const defaults = await api<any>(`/orders/quotation-defaults/${id}`);
    if (token !== selection.current) return;
    setCustomerName(defaults.customerName);
    const { customerName: _name, quotationType, ...values } = defaults;
    setSelectedType(quotationType);
    setInput((v) => ({ ...v, ...values }));
  }
  const customerFields = [
    "contactPerson",
    "designation",
    "phone",
    "email",
    "billingAddress",
  ];
  function renderField([field, label]: [keyof OrderInput, string]) {
    if (
      ["poNumber", "customerNtn", "customerStrn"].includes(field) &&
      input.evidenceType !== "Customer PO"
    )
      return null;
    if (["customerNtn", "customerStrn"].includes(field) && !document)
      return null;
    return (
      <label key={field}>
        {label}
        {field === "salesSource" ? (
          <select
            aria-label="Sales source"
            value={String(input.salesSource ?? "")}
            onChange={(e) => change("salesSource", e.target.value)}
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
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
            {input.salesSource &&
              ![
                "Sales team",
                "Director referral",
                "Existing customer",
                "Customer referral",
                "Website / online inquiry",
                "Walk-in",
                "Other",
              ].includes(input.salesSource) && (
                <option>{input.salesSource}</option>
              )}
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
              (field === "poNumber" && input.evidenceType === "Customer PO")
            }
            maxLength={
              field === "remarks" || field === "evidenceNotes"
                ? 2000
                : field.endsWith("Address")
                  ? 1000
                  : field === "salesPerson" || field === "poNumber"
                    ? 100
                    : field === "invoiceCompany"
                      ? 200
                      : 300
            }
            placeholder={field === "email" ? "N/A" : undefined}
            value={String(input[field] ?? "")}
            onChange={(e) => change(field, e.target.value)}
          />
        )}
        {field === "invoiceCompany" && (
          <small>
            The customer or legal entity receiving the invoice. Filled from the
            customer record; edit if their billing name differs.
          </small>
        )}
      </label>
    );
  }
  const rawSnapshot = saved?.snapshot ?? review?.snapshot ?? preview?.snapshot;
  const snapshot = rawSnapshot
    ? {
        ...rawSnapshot,
        quotationType:
          saved?.quotationType ??
          review?.quotationType ??
          rawSnapshot.quotationType ??
          rawSnapshot.peachtree ??
          selectedType,
      }
    : undefined;
  const view = snapshot ? ipoPresentation(snapshot) : undefined;
  return (
    <div className="orders-module">
      {saved?.external_approval && (
        <section aria-label="Recorded external approval">
          <strong>External approval recorded</strong>
          <p>
            Method: {saved.external_approval.channel} · Approver:{" "}
            {saved.external_approval.approver} ·{" "}
            {saved.external_approval.comments}
          </p>
          {saved.external_approval.evidence?.map((e: any) => (
            <p key={e.id}>
              <a href={`/api/boqs/uploads/${e.id}`}>{e.filename}</a>
            </p>
          ))}
        </section>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!initialIpoId && (
        <section className="detail-panel">
          <h2>Receive customer PO & prepare IPO</h2>
          <p>
            Select the exact quotation accepted by the customer. IPO rates are
            net selling rates; the approved costing stays unchanged.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const body = orderSchema.parse({
                  ...input,
                  customerAccepted: accepted,
                });
                setPreview(
                  await api("/orders/preview", {
                    body,
                    csrf: session.csrfToken,
                  }),
                );
                setSaved(undefined);
              });
            }}
          >
            {input.quotationId && selectedType && (
              <p>
                <strong>Quotation type:</strong>{" "}
                {quotationTypeLabel(selectedType)}
              </p>
            )}
            <fieldset disabled={busy} className="order-fields">
              <label>
                Accepted quotation
                <select
                  required
                  value={input.quotationId ?? ""}
                  onChange={(e) => void act(() => choose(e.target.value))}
                >
                  <option value="">Select saved quotation</option>
                  {quotes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.number} · {q.customer} · {q.site}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sale confirmation type
                <select
                  required
                  value={input.evidenceType ?? ""}
                  onChange={(e) => {
                    change("evidenceType", e.target.value);
                    setInput((v) => ({
                      ...v,
                      customerNtn: "",
                      customerStrn: "",
                      poNumber: "",
                      orderDate:
                        e.target.value === "Customer PO"
                          ? ""
                          : new Date().toLocaleDateString("en-CA"),
                    }));
                  }}
                >
                  <option value="">Select evidence type</option>
                  {[
                    "Customer PO",
                    "Written approval",
                    "WhatsApp approval",
                    "Verbal sale confirmation",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              {fields
                .filter(([field]) => !customerFields.includes(field))
                .map(renderField)}
            </fieldset>
            {customerName && (
              <section
                className="ipo-customer-summary"
                aria-label="Customer details"
              >
                <h3>{customerName}</h3>
                <p>
                  {input.contactPerson || customerName} · {input.phone || "N/A"}{" "}
                  · {input.email || "N/A"}
                </p>
                <p>
                  Billing address: {input.billingAddress || "Need to enter"}
                </p>
                <details>
                  <summary>Edit customer & billing details</summary>
                  <fieldset className="order-fields" disabled={busy}>
                    {fields
                      .filter(([field]) => customerFields.includes(field))
                      .map(renderField)}
                  </fieldset>
                </details>
              </section>
            )}
            <p className="form-note">
              Operations collects delivery address, site contact and delivery
              schedule after receiving the BOQ.
            </p>
            <fieldset disabled={busy} className="order-fields">
              <label>
                {input.evidenceType === "Customer PO"
                  ? "Customer PO document"
                  : "Sale approval attachment"}{" "}
                (PDF, PNG or JPEG; up to 8 MB)
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void act(async () => {
                      if (file.size > 8388608)
                        throw new Error(
                          "PO document must be no larger than 8 MB.",
                        );
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      let data = "";
                      for (let i = 0; i < bytes.length; i += 32768)
                        data += String.fromCharCode(
                          ...bytes.subarray(i, i + 32768),
                        );
                      const d = await api<any>("/orders/documents", {
                        body: {
                          filename: file.name,
                          mime: file.type,
                          base64: btoa(data),
                        },
                        csrf: session.csrfToken,
                      });
                      setDocument(d);
                      change("documentId", d.id);
                      if (input.evidenceType === "Customer PO") {
                        try {
                          const result = await extractText(file, setExtraction);
                          const suggestions = poSuggestions(result.text);
                          setInput((v) => ({ ...v, ...suggestions }));
                          setExtraction(
                            Object.keys(suggestions).length
                              ? "PO suggestions filled. Check PO reference, order date, NTN/STRN and billing address against the document before submitting."
                              : "No unambiguous labelled PO fields found. Review the document and enter its date, reference and billing details manually.",
                          );
                        } catch {
                          setExtraction(
                            "Document uploaded. Automatic extraction unavailable; enter the PO details manually.",
                          );
                        }
                      }
                    });
                  }}
                />
                {document && <small>Uploaded: {document.filename}</small>}
                {extraction && <small role="status">{extraction}</small>}
              </label>
            </fieldset>
            <label className="checkbox-label">
              <input
                type="checkbox"
                required
                checked={accepted}
                disabled={busy}
                onChange={(e) => {
                  setAccepted(e.target.checked);
                  setPreview(undefined);
                  setSaved(undefined);
                  setReview(undefined);
                  setKey(crypto.randomUUID());
                }}
              />
              Sale has been confirmed against this exact quotation using the
              evidence recorded above.
            </label>
            <button className="dark-button" disabled={busy}>
              {busy ? "Working…" : "Review IPO"}
            </button>
          </form>
        </section>
      )}
      {snapshot && (
        <section className="detail-panel">
          <h2>
            {saved
              ? `${saved.number} · Saved IPO`
              : review
                ? "IPO submission · Awaiting evidence approval"
                : "IPO preview · Not saved"}
          </h2>
          <p>
            {snapshot.customer.name} · {snapshot.quotationNumber} ·{" "}
            {snapshot.input.evidenceType} {snapshot.input.poNumber} ·{" "}
            {snapshot.boqNumber}
          </p>
          <p>
            <strong>Quotation type:</strong>{" "}
            {quotationTypeLabel(saved?.quotationType ?? snapshot)}
          </p>
          <p>Evidence: {snapshot.input.evidenceNotes}</p>
          <p>
            Final payable:{" "}
            <strong>PKR {money(snapshot.allocation.total)}</strong> · Matches
            quotation after discount.
          </p>
          <div className="order-table-scroll">
            <table className="order-table">
              <thead>
                <tr>
                  {(view!.included
                    ? ["Description", "Qty", "Unit", "Rate", "Amount"]
                    : [
                        "Description",
                        "Qty",
                        "Unit",
                        "Net rate",
                        "Amount",
                        "Tax %",
                        "Tax",
                        "Total",
                      ]
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view!.rows.map((l: any, i: number) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "pre-line" }}>{l.description}</td>
                    <td>{l.qty}</td>
                    <td>{l.unit}</td>
                    <td>{money(l.rate)}</td>
                    <td>{money(l.amount)}</td>
                    {!view!.included && (
                      <>
                        <td>{l.taxRate}%</td>
                        <td>{money(l.tax)}</td>
                        <td>{money(l.total)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Grand total</th>
                  <td>{money(view!.amount)}</td>
                  {!view!.included && (
                    <>
                      <td></td>
                      <td>{money(view!.tax)}</td>
                      <td>{money(view!.total)}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="survey-actions">
            {saved && onOperations && !initialIpoId && (
              <button onClick={() => onOperations(saved.id)}>
                Send BOQ to Operations
              </button>
            )}
            {!saved && !review && preview && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (
                      !confirmTransition(
                        "Submit sale evidence for IPO approval",
                        "Management will review the accepted quotation and attached sale evidence before issuing the IPO.",
                      )
                    )
                      return;
                    const row = await api<any>("/orders/submissions", {
                      body: {
                        input: orderSchema.parse({
                          ...input,
                          customerAccepted: accepted,
                        }),
                        fingerprint: preview.fingerprint,
                        requestKey: key,
                      },
                      csrf: session.csrfToken,
                    });
                    setReview(row);
                    setPreview(undefined);
                    setKey(crypto.randomUUID());
                    await load();
                  })
                }
              >
                Submit evidence for IPO approval
              </button>
            )}
            {!saved && manager && (
              <button
                className="dark-button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    if (
                      !confirmTransition(
                        "Approve evidence and issue IPO",
                        "This creates the immutable IPO and Peachtree accounts pack from the accepted quotation.",
                      )
                    )
                      return;
                    const row = review
                      ? await api<any>(
                          `/orders/submissions/${review.id}/approve`,
                          {
                            body: { requestKey: key },
                            csrf: session.csrfToken,
                          },
                        )
                      : await api<any>("/orders", {
                          body: {
                            input: orderSchema.parse({
                              ...input,
                              customerAccepted: accepted,
                            }),
                            fingerprint: preview.fingerprint,
                            requestKey: key,
                          },
                          csrf: session.csrfToken,
                        });
                    setSaved(row);
                    setPreview(undefined);
                    setReview(undefined);
                    await load();
                  })
                }
              >
                Approve evidence & save IPO
              </button>
            )}
            {!saved && review && session.user.role === "Coordinator" && (
              <ExternalApproval
                key={review.id}
                session={session}
                endpoint={`/orders/submissions/${review.id}/external-approval`}
                onApproved={async (row) => {
                  setSaved(await api(`/orders/${row.id}`));
                  setReview(undefined);
                  await load();
                }}
              />
            )}
            {!saved && !manager && (
              <p>
                Admin or Management must approve the sale evidence before an IPO
                is issued.
              </p>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const url = saved
                    ? `/api/orders/${saved.id}/ipo.pdf`
                    : review
                      ? `/api/orders/submissions/${review.id}/preview.pdf`
                      : "/api/orders/preview.pdf";
                  const r = await fetch(
                    url,
                    saved || review
                      ? { credentials: "same-origin" }
                      : {
                          method: "POST",
                          credentials: "same-origin",
                          headers: {
                            "Content-Type": "application/json",
                            "X-CSRF-Token": session.csrfToken,
                          },
                          body: JSON.stringify(
                            orderSchema.parse({
                              ...input,
                              customerAccepted: accepted,
                            }),
                          ),
                        },
                  );
                  if (!r.ok) throw new Error("Unable to create IPO PDF.");
                  const u = URL.createObjectURL(await r.blob());
                  const a = window.document.createElement("a");
                  a.href = u;
                  a.download = `${saved?.number ?? "DRAFT"}-IPO-and-Peachtree.pdf`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                })
              }
            >
              {saved
                ? "Download IPO & Peachtree PDF"
                : "Download IPO & Peachtree preview"}
            </button>
            {(saved || review) && (
              <SharePdf
                url={
                  saved
                    ? `/api/orders/${saved.id}/ipo.pdf`
                    : `/api/orders/submissions/${review.id}/preview.pdf`
                }
                filename={`${saved?.number ?? "IPO-approval"}-IPO-and-Peachtree.pdf`}
              />
            )}
            {saved &&
              ["Admin", "Management", "Coordinator"].includes(
                session.user.role,
              ) &&
              (saved.accounts_handoff ? (
                <p role="status">
                  Sent to Accounts by {saved.accounts_handoff.sent_by} ·{" "}
                  {new Date(saved.accounts_handoff.created_at).toLocaleString()}
                </p>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      !confirmTransition(
                        "Send IPO to Accounts",
                        `${saved.number} and its Peachtree division will appear in the Accounts Received IPOs bucket as one PDF document.`,
                      )
                    )
                      return;
                    void act(async () => {
                      await api(`/orders/${saved.id}/accounts-handoff`, {
                        body: {},
                        csrf: session.csrfToken,
                      });
                      setSaved(await api(`/orders/${saved.id}`));
                    });
                  }}
                >
                  Send IPO to Accounts
                </button>
              ))}
            {snapshot.document && (
              <a
                href={`/api/orders/documents/${snapshot.document.id}`}
                download
              >
                Download customer PO
              </a>
            )}
          </div>
          <details>
            <summary>Internal discount allocation · Reporting record</summary>
            <p>
              Original after-tax discount: PKR{" "}
              {money(snapshot.allocation.originalDiscount)}. Solar and non-18%
              items receive no allocation. This record is preserved with the IPO
              and is omitted from its PDF.
            </p>
            <div className="order-table-scroll">
              <table className="order-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Original before tax</th>
                    <th>Discount after tax</th>
                    <th>Before-tax reduction</th>
                    <th>Tax reduction</th>
                    <th>Tax rounding</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.allocation.lines.map((l: any, i: number) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "pre-line" }}>
                        {l.description}
                      </td>
                      <td>{money(l.originalBeforeTax)}</td>
                      <td>{money(l.allocatedDiscount)}</td>
                      <td>{money(l.beforeTaxReduction)}</td>
                      <td>{money(l.taxReduction)}</td>
                      <td>{money(l.taxRoundingAdjustment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
      {initialIpoId && saved && (
        <Operations session={session} initialIpoId={initialIpoId} />
      )}
      {!initialIpoId && (
        <>
          <section className="detail-panel">
            <h2>Evidence awaiting IPO approval</h2>
            {submissions
              .filter((s) => !s.ipo_id)
              .map((s) => (
                <p key={s.id}>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setReview(s);
                      setSaved(undefined);
                      setPreview(undefined);
                      setKey(crypto.randomUUID());
                    }}
                  >
                    {s.snapshot.quotationNumber} · {s.input.evidenceType} ·{" "}
                    {s.prepared_by}
                  </button>
                  <small>
                    {quotationTypeLabel(s.quotationType ?? s.snapshot)}
                  </small>
                </p>
              ))}
            {!submissions.some((s) => !s.ipo_id) && (
              <p>No pending submissions.</p>
            )}
          </section>
          <section className="detail-panel">
            <h2>Saved IPOs</h2>
            {!orders.length ? (
              <p>No IPOs saved yet.</p>
            ) : (
              <div className="order-table-scroll">
                <table className="order-table">
                  <thead>
                    <tr>
                      <th>IPO</th>
                      <th>Customer</th>
                      <th>Customer PO</th>
                      <th>Quotation</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                setSaved(await api(`/orders/${o.id}`));
                                setPreview(undefined);
                                setReview(undefined);
                              })
                            }
                          >
                            {o.number}
                          </button>
                        </td>
                        <td>{o.customer}</td>
                        <td>{o.po_number}</td>
                        <td>
                          {o.quotation_number}
                          <br />
                          <small>{quotationTypeLabel(o.quotationType)}</small>
                        </td>
                        <td>{money(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
