import type { ApprovalInstructions as Instructions } from "../../server/boq/instructions.js";
export const blankInstructions = (): Instructions => ({
  cashGstTreatment:undefined,presentation: "No Breakup",
  taxMode: "Show Sales Tax Separately",
  markups: {
    solar: "0",
    structure: "0",
    bess: "0",
    earthing: "0",
    balance: "0",
    rest: "0",
  },
  notes: "",
});
export function ApprovalInstructions({
  value,
  onChange,
  disabled = false,
}: {
  value: Instructions;
  onChange: (v: Instructions) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="detail-panel">
      <legend>Quotation instructions</legend>
      <p>
        Choose the quotation format, tax display and markup on cost for Atif.
        These instructions are saved with this costing approval.
      </p>
      <div className="survey-grid">
        <label>Quotation type<select value={value.saleType ?? "Tax Deal"} onChange={e=>onChange({...value,saleType:e.target.value as Instructions["saleType"]})}><option>Tax Deal</option><option>Cash Deal</option></select></label>
        {value.saleType === "Cash Deal" && <label>Cash deal GST treatment<select value={value.cashGstTreatment ?? "No GST added"} onChange={e=>onChange({...value,cashGstTreatment:e.target.value as Instructions["cashGstTreatment"],taxMode:"Tax Included"})}><option>No GST added</option><option>Included in selling price</option></select></label>}
        <label>
          Quotation format
          <select
            aria-label="Approval quotation format"
            value={value.presentation}
            onChange={(e) =>
              onChange({
                ...value,
                presentation: e.target.value as Instructions["presentation"],
              })
            }
          >
            <option>No Breakup</option>
            <option>Basic Breakup</option>
            <option>Full Breakup</option>
          </select>
        </label>
        <label>
          Tax display
          <select
            aria-label="Approval tax display"
            value={value.taxMode}
            onChange={(e) =>
              onChange({
                ...value,
                taxMode: e.target.value as Instructions["taxMode"],
              })
            }
          >
            <option>Show Sales Tax Separately</option>
            <option>Tax Included</option>
          </select>
        </label>
        {Object.entries({
          solar: "Solar",
          structure: "Structure",
          bess: "BESS",
          earthing: "Earthing",
          balance: "Balance of systems",
          rest: "Other items",
        }).map(([key, label]) => (
          <label key={key}>
            {label} markup %
            <input
              aria-label={`Approval ${label} markup %`}
              type="number"
              min="0"
              max="999999"
              step="0.0001"
              value={value.markups[key as keyof Instructions["markups"]]}
              onChange={(e) =>
                onChange({
                  ...value,
                  markups: { ...value.markups, [key]: e.target.value },
                })
              }
            />
          </label>
        ))}
      </div>
      <label>
        Instructions for quotation
        <textarea
          aria-label="Instructions for quotation"
          value={value.notes}
          maxLength={2000}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </label>
    </fieldset>
  );
}
