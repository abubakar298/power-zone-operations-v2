import { useEffect, useState } from "react";
import { Decimal } from "decimal.js";
import { api } from "../api.js";
import { Button } from "../ui/Button.js";
import { DocumentPreview } from "./DocumentPreview.js";
import { saleConfirmationFields } from "../pages/Orders.js";
import { extractText } from "../ocr.js";
import { poSuggestions } from "../../server/orders/po-extraction.js";
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
export function ConfirmSaleForm({ session, detail, action, onBack }: any) {
  const r = detail.record,
    c = detail.masterReview.customer,
    framework = r.route.endsWith("framework");
  const [input, setInput] = useState<Record<string, string>>({
      evidenceType: "",
      orderDate: today(),
      invoiceCompany: "PZES (PVT Ltd)",
      salesPerson: "Atif",
      contactPerson: c.contact_person ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      billingAddress: c.address ?? "",
      paymentContact: c.contact_person ?? "",
      paymentPhone: c.phone ?? "",
      evidenceNotes: "",
      poNumber: "",
    }),
    [basis, setBasis] = useState<any>(),
    [basisError, setBasisError] = useState(""),
    [document, setDocument] = useState<any>(),
    [text, setText] = useState(""),
    [poTotal, setPoTotal] = useState(""),
    [poTax, setPoTax] = useState(""),
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
  const issues: string[] = [];
  if (po && document) {
    if (!/^\d+(\.\d+)?$/.test(poTotal))
      issues.push("PO total amount is missing or unreadable");
    else if (basis && !new Decimal(poTotal).eq(basis.comparison.total))
      issues.push(
        `Amount differs: approved PKR ${money(basis.comparison.total)}, PO PKR ${money(poTotal)}`,
      );
    if (!/^\d+(\.\d+)?$/.test(poTax))
      issues.push("PO sales tax is missing or unreadable");
    else if (basis && !new Decimal(poTax).eq(basis.comparison.tax))
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
    if (!scope)
      issues.push("PO scope, quantities and terms require confirmation");
  }
  const confirmationRequirements = [
    ...(!basis ? [basisError ? `Unable to load approved quotation: ${basisError}` : "Loading approved quotation details…"] : []),
    ...(!input.evidenceType ? ["Select the sale confirmation type."] : []),
    ...(!document ? ["Upload the PO or WhatsApp approval attachment."] : []),
    ...(!input.orderDate ? ["Enter the Order Date."] : []),
    ...(po && !input.poNumber ? ["Enter the Customer PO reference."] : []),
    ...issues,
    ...(!accepted
      ? ["Confirm the customer approved the selected document."]
      : []),
  ];
  function renderField([field, label]: any) {
    if (
      ["poNumber", "customerNtn", "customerStrn"].includes(field) &&
      (!po || (["customerNtn", "customerStrn"].includes(field) && !document))
    )
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
            value={input[field] ?? ""}
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
      if (po) {
        setProgress("Reading uploaded PO…");
        const read = await extractText(file, setProgress);
        setText(read.text);
        setInput((old) => ({
          ...old,
          ...Object.fromEntries(
            Object.entries(poSuggestions(read.text))
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key, String(value)]),
          ),
        }));
        setPoTotal(amount(read.text, "total"));
        setPoTax(amount(read.text, "tax"));
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
    accepted,
    poTotal,
    poTax,
  });
  const currentPreview =
    salePreview?.key === previewKey ? salePreview : undefined;
  function receiptPayload() {
    return {
      reference: po ? input.poNumber : `WA-${r.siteCode}-${input.orderDate}`,
      date: input.orderDate,
      evidenceId: document.id,
      basisType: framework ? "framework" : "quotation",
      frameworkId: framework ? basis.source.id : undefined,
      quotationId: !framework ? basis.source.id : undefined,
      confirmationType: po ? "Customer PO" : "WhatsApp approval",
      saleDetails: input,
      actual: po ? structuredClone(basis.comparison) : undefined,
      reviewed: true,
      customerNtn: po ? (input.customerNtn ?? "") : "",
      customerStrn: po ? (input.customerStrn ?? "") : "",
      notes: input.evidenceNotes,
    };
  }
  function validation() {
    return [
      ...confirmationRequirements,
      ...(!input.invoiceCompany.trim() ? ["Enter the invoice company."] : []),
      ...(!input.salesPerson.trim() ? ["Enter the sales person."] : []),
      ...(!input.evidenceNotes.trim()
        ? ["Enter the approval evidence details."]
        : []),
    ];
  }
  async function previewDocuments() {
    const missing = validation();
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
  return (
    <div className="pz-stack orders-module">
      <div>
        <Button variant="neutral" onClick={onBack}>
          Back to PO Receipt
        </Button>
      </div>
      <section className="pz-panel">
        <h2>Confirm Sale</h2>
        <form onSubmit={submit} noValidate>
          <fieldset disabled={busy} className="order-fields">
            <label>
              Accepted quotation / UBL survey
              <input
                readOnly
                value={
                  basis?.source.key ??
                  `${r.customerCode} · ${r.site} (${r.siteCode})`
                }
              />
              <small>
                Fixed to the selected customer’s current approved document.
              </small>
            </label>
            <label>
              Sale confirmation type
              <select
                required
                value={input.evidenceType}
                onChange={(e) => {
                  change("evidenceType", e.target.value);
                  setInput((old) => ({
                    ...old,
                    poNumber: "",
                    customerNtn: "",
                    customerStrn: "",
                    orderDate: e.target.value === "Customer PO" ? "" : today(),
                  }));
                  setDocument(undefined);
                  setText("");
                  setPoTotal("");
                  setPoTax("");
                  setAccepted(false);
                  setScope(false);
                }}
              >
                <option value="">Select evidence type</option>
                <option>Customer PO</option>
                <option>WhatsApp approval</option>
              </select>
            </label>
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
          <p className="form-note">
            Operations collects delivery address, site contact and delivery
            schedule after receiving the BOQ.
          </p>
          {input.evidenceType && (
            <fieldset className="order-fields" disabled={busy}>
              <label>
                {po ? "Customer PO document" : "WhatsApp approval attachment"}{" "}
                (PDF, PNG or JPEG; up to 8 MB)
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
              </label>
            </fieldset>
          )}
          {progress && <p role="status">{progress}</p>}
          {document && (
            <>
              <p role="status">Attached: {document.filename}</p>
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
          {po && document && (
            <>
              <h3>PO Comparison Summary</h3>
              {issues.length ? (
                <ul>
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>Confirmed PO values match the approved basis.</p>
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
              <label className="pz-review-check">
                <input
                  type="checkbox"
                  checked={scope}
                  onChange={(e) => setScope(e.target.checked)}
                />
                I checked the PO’s configuration, scope, quantities and terms
                against the approved document.
              </label>
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
          {currentPreview && (
            <section className="pz-stack">
              <p className="form-note">
                Draft previews only. IPO number is assigned on issuance; nothing
                has been saved or sent.
              </p>
              <details open>
                <summary>IPO Preview</summary>
                <DocumentPreview
                  url=""
                  data={currentPreview.ipo}
                  title="Draft IPO"
                />
              </details>
              <details>
                <summary>PT Breakup Preview</summary>
                <DocumentPreview
                  url=""
                  data={currentPreview.pt}
                  title="Draft PT Breakup"
                />
              </details>
              <label className="pz-review-check">
                <input
                  type="checkbox"
                  checked={previewReviewed}
                  onChange={(e) => setPreviewReviewed(e.target.checked)}
                />
                I reviewed the IPO and PT breakup for Accounts.
              </label>
            </section>
          )}
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
