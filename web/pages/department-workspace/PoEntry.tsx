import { defaultIpoInvoiceTerms, type IpoInvoiceTerms } from "../../../shared/ipo-invoice-terms.js";
import { IpoInvoiceTermsField } from "../../components/IpoInvoiceTermsField.js";
import { useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../ui/Button.js";
import { confirmTransition } from "../../confirm.js";
import { Action, FrameworkSelect, ApprovedQuoteSelect, Input, label, ErrorText } from "./parts.js";

export function DifferenceTable({ differences }: any) {
  return differences.length ? (
    <div className="pz-table-scroll">
      <table>
        <thead>
          <tr>
            <th>Difference</th>
            <th>Approved</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {differences.map((d: any) => (
            <tr key={d.field}>
              <td>{d.field}</td>
              <td>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(d.approved, null, 2)}
                </pre>
              </td>
              <td>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(d.received, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p>The entered PO matches the selected approved basis.</p>
  );
}
export function PoEntry({ session, refs, detail, action }: any) {
  const r = detail.record,
    [basis, setBasis] = useState<any>(detail.basis),
    [actual, setActual] = useState<any>(detail.receipt?.input.actual),
    [chosenTerms, setChosenTerms] = useState<IpoInvoiceTerms | "">(detail.receipt?.input?.invoiceTerms ?? ""),
    [differences, setDifferences] = useState<any[]>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const framework = r.route.endsWith("framework");
  const invoiceTerms = chosenTerms || (framework ? defaultIpoInvoiceTerms(basis?.source?.key) : "");
  return (
    <Action
      title="Complete & Send — compare PO and issue"
      onSubmit={async (f) => {
        if (!actual)
          throw new Error(
            "Load the approved basis and enter the received PO comparison.",
          );
        if (!invoiceTerms) throw new Error("Select invoice terms.");
        if (!f.has("reviewed"))
          throw new Error(
            "Confirm that all quantities, brands, values, tax and terms were checked against the attachment.",
          );
        if (
          !confirmTransition(
            "Record PO comparison",
            "A match issues the IPO to Accounts and BOQ to Operations. A mismatch goes to Management.",
          )
        )
          return;
        await action("receipt", {
          reference: f.get("reference"),
          date: f.get("date"),
          evidenceId: f.get("evidenceId"),
          invoiceTerms,
          basisType: framework ? "framework" : "quotation",
          frameworkId: framework ? basis?.source.id : undefined,
          quotationId: !framework ? basis?.source.id : undefined,
          actual,
          reviewed: true,
          customerNtn: f.get("customerNtn") ?? "",
          customerStrn: f.get("customerStrn") ?? "",
          notes: f.get("notes"),
        });
      }}
    >
      <p>
        Compare against the exact approved version, including scope, Item IDs,
        quantities, selling values, tax and terms.
      </p>
      <div className="pz-form-grid">
        {framework ? (
          <FrameworkSelect {...{ refs, r }} />
        ) : (
          <ApprovedQuoteSelect
            refs={refs}
            r={r}
            value={r.quotation?.id ?? r.data.basisSource?.id}
          />
        )}
        <Input
          name="reference"
          title="PO number / confirmation reference"
          required
        />
        <Input
          name="date"
          title="PO / confirmation date"
          type="date"
          required
        />
        <label>
          PO evidence
          <select name="evidenceId" required>
            <option value="">Select uploaded PO / confirmation</option>
            {detail.files
              .filter((f: any) => f.kind === "PO / confirmation")
              .map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.filename}
                </option>
              ))}
          </select>
        </label>
        <Input name="customerNtn" title="Customer NTN (Tax Deal)" />
        <Input name="customerStrn" title="Customer STRN (Tax Deal)" />
      </div>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async (e) => {
          setError("");
          setBusy(true);
          try {
            const f = new FormData(e.currentTarget.closest("form")!);
            const b = await api<any>(`/project-workflow/${r.id}/preview`, {
              csrf: session.csrfToken,
              body: framework
                ? { kind: "framework", frameworkId: f.get("frameworkId") }
                : { kind: "quotation", quotationId: f.get("quotationId") },
            });
            setBasis(b);
            setActual(structuredClone(b.comparison));
            setDifferences(undefined);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Load approved basis for comparison
      </Button>
      <ErrorText error={error} />
      {basis && actual && (
        <>
          <p>
            Source: {basis.source.key} · v{basis.source.version}. Initial
            entries below copy the approved basis; review and correct them to
            match the actual PO.
          </p>
          <ComparisonEditor value={actual} onChange={setActual} />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                const p = await api<any>(`/project-workflow/${r.id}/preview`, {
                  csrf: session.csrfToken,
                  body: {
                    kind: framework ? "framework" : "quotation",
                    frameworkId: framework ? basis.source.id : undefined,
                    quotationId: !framework ? basis.source.id : undefined,
                    actual,
                  },
                });
                setDifferences(p.differences);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Show differences before saving
          </Button>
          {differences && <DifferenceTable differences={differences} />}
          <div className="pz-form-grid"><IpoInvoiceTermsField id="po-comparison-invoice-terms" value={invoiceTerms} onChange={setChosenTerms} disabled={busy}/></div>
          <label>
            <input type="checkbox" name="reviewed" required /> I checked the
            entered scope, quantities, prices, taxes and terms against the
            attached PO.
          </label>
        </>
      )}
      <label>
        Comparison remarks
        <textarea name="notes" required />
      </label>
    </Action>
  );
}
export function ComparisonEditor({ value, onChange }: any) {
  const update = (k: string, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="pz-stack">
      {["materials", "billing"].map((k) => (
        <section key={k}>
          <h3>
            {k === "materials"
              ? "PO scope and material quantities"
              : "PO selling amounts excluding GST"}
          </h3>
          <div className="pz-table-scroll">
            <table>
              <thead>
                <tr>
                  {(k === "materials"
                    ? [
                        "Item ID",
                        "Description",
                        "Qty",
                        "Unit",
                        "Brand",
                        "Specification",
                      ]
                    : [
                        "Description",
                        "Qty",
                        "Unit",
                        "Rate",
                        "Amount",
                        "Tax rate %",
                      ]
                  ).map((n) => (
                    <th key={n}>{n}</th>
                  ))}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {value[k].map((l: any, i: number) => (
                  <tr key={l.lineId}>
                    {(k === "materials"
                      ? [
                          "itemId",
                          "description",
                          "qty",
                          "unit",
                          "brand",
                          "specification",
                        ]
                      : [
                          "description",
                          "qty",
                          "unit",
                          "rate",
                          "amount",
                          "taxRate",
                        ]
                    ).map((field) => (
                      <td key={field}>
                        <input
                          aria-label={`${k} ${i + 1} ${field}`}
                          value={l[field]}
                          onChange={(e) =>
                            update(
                              k,
                              value[k].map((x: any, n: number) =>
                                n === i ? { ...x, [field]: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <Button
                        onClick={() =>
                          update(
                            k,
                            value[k].filter((_: any, n: number) => n !== i),
                          )
                        }
                      >
                        Remove line
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            onClick={() =>
              update(k, [
                ...value[k],
                k === "materials"
                  ? {
                      lineId: crypto.randomUUID(),
                      itemId: "",
                      description: "",
                      qty: "0",
                      unit: "PCS",
                      brand: "",
                      specification: "",
                    }
                  : {
                      lineId: crypto.randomUUID(),
                      description: "",
                      qty: "0",
                      unit: "JOB",
                      rate: "0",
                      amount: "0",
                      taxRate: "18",
                    },
              ])
            }
          >
            Add received PO line
          </Button>
        </section>
      ))}
      <div className="pz-form-grid">
        {["subtotal", "discount", "tax", "total"].map((k) => (
          <label key={k}>
            {label(k)}
            <input
              value={value[k]}
              onChange={(e) => update(k, e.target.value)}
            />
          </label>
        ))}
        <label>
          Deal type
          <select
            value={value.saleType}
            onChange={(e) => update("saleType", e.target.value)}
          >
            <option>Tax Deal</option>
            <option>Cash Deal</option>
          </select>
        </label>
        <label>
          Invoice company
          <input
            value={value.invoiceCompany}
            onChange={(e) => update("invoiceCompany", e.target.value)}
          />
        </label>
        {value.saleType === "Cash Deal" && (
          <label>
            Cash deal GST treatment
            <input
              value={value.cashGstTreatment}
              onChange={(e) => update("cashGstTreatment", e.target.value)}
            />
          </label>
        )}
        {Object.entries(value.terms).map(([k, v]) => (
          <label key={k}>
            {label(k)} terms
            <textarea
              value={String(v)}
              onChange={(e) =>
                update("terms", { ...value.terms, [k]: e.target.value })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
export function FrameworkEditor({ session, refs, onSaved }: any) {
  return (
    <details className="pz-panel">
      <summary>Approve a pre-agreed customer configuration</summary>
      <Action
        title="Save approved agreement version"
        onSubmit={async (f) => {
          await api("/project-workflow/frameworks", {
            csrf: session.csrfToken,
            body: {
              customerId: Number(f.get("customerId")),
              key: f.get("key"),
              quotationId: f.get("quotationId"),
              sourceReference: f.get("sourceReference"),
              routes: f.getAll("routes"),
            },
          });
          await onSaved();
        }}
      >
        <p>
          Uses an exact approved quotation to freeze scope, Item IDs, amounts,
          taxes, discount and PT allocation for future routes. Existing approved
          versions remain unchanged.
        </p>
        <div className="pz-form-grid">
          <label>
            Customer
            <select name="customerId" required>
              {refs.customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.short_code} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <Input name="key" title="Configuration name / ID" required />
          <ApprovedQuoteSelect refs={refs} template />
          <label>
            <input
              type="checkbox"
              name="routes"
              value="survey-framework"
              defaultChecked
            />{" "}
            Permit survey → recommendation → PO
          </label>
          <label>
            <input
              type="checkbox"
              name="routes"
              value="direct-framework"
              defaultChecked
            />{" "}
            Permit direct PO without survey
          </label>
          <Input
            name="sourceReference"
            title="Agreement / approval evidence reference"
            required
          />
        </div>
      </Action>
    </details>
  );
}
