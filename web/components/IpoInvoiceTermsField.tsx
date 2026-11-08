import { ipoInvoiceTerms, ipoInvoiceTermsLabels, type IpoInvoiceTerms } from "../../shared/ipo-invoice-terms.js";
import { Field } from "../ui/Field.js";

export function IpoInvoiceTermsField({
  id, value, onChange, disabled, label = "Invoice terms", placeholder = "Select when to invoice", required = true,
}: {
  id: string;
  value: IpoInvoiceTerms | "";
  onChange: (value: IpoInvoiceTerms | "") => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return <Field id={id} label={label}>
    <select id={id} value={value} required={required} disabled={disabled}
      onChange={event => onChange(event.target.value as IpoInvoiceTerms | "")}>
      <option value="">{placeholder}</option>
      {ipoInvoiceTerms.map(term => <option key={term} value={term}>{ipoInvoiceTermsLabels[term]}</option>)}
    </select>
  </Field>;
}
