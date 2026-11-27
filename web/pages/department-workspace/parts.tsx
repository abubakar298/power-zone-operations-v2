import { useUnsavedChanges } from "../../hooks/useUnsavedChanges.js";
import { useState, type FormEvent } from "react";
import { Button } from "../../ui/Button.js";

export const day = (value: any) => (value ? String(value).slice(0, 10) : "");
export const label = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
export function Input({
  name,
  title,
  value = "",
  type = "text",
  required = false,
  readOnly = false,
}: {
  name: string;
  title: string;
  value?: any;
  type?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label>
      {title}
      <input
        name={name}
        type={type}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? 0 : undefined}
        defaultValue={value}
        required={required}
        readOnly={readOnly}
      />
    </label>
  );
}
export function Action({
  title,
  submitLabel,
  onSubmit,
  children,
  disabled = false,
  formId,
  hideSubmit = false,
  alternateSubmitLabel,
}: {
  title: string;
  submitLabel?: string;
  onSubmit: (f: FormData, intent?: string) => Promise<void | boolean>;
  children?: any;
  disabled?: boolean;
  formId?: string;
  hideSubmit?: boolean;
  alternateSubmitLabel?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  return (
    <form
      id={formId}
      onChange={() => setDirty(true)}
      className="pz-panel pz-stack pz-workflow-form"
      onSubmit={async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError("");
        setBusy(true);
        try {
          const submitter = (e.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          const result = await onSubmit(f, submitter?.value ?? "save");
          if (result !== false) setDirty(false);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{title}</h3>
      {children}
      <div>
        <div
          className={
            alternateSubmitLabel ? "pz-survey-save-actions" : "pz-action-row"
          }
        >
          {!hideSubmit && (
            <Button
              type="submit"
              name="intent"
              value="save"
              variant={alternateSubmitLabel ? "secondary" : "primary"}
              loading={busy}
              disabled={disabled}
            >
              {submitLabel ?? title}
            </Button>
          )}
          {alternateSubmitLabel && (
            <Button
              type="submit"
              name="intent"
              value="complete"
              variant="primary"
              loading={busy}
              disabled={disabled}
            >
              {alternateSubmitLabel}
            </Button>
          )}
        </div>
        <ErrorText error={error} />
      </div>
    </form>
  );
}
export function People({
  refs,
  name,
  title,
  role,
  value = "",
  multiple = false,
}: {
  refs: any;
  name: string;
  title: string;
  role: string;
  value?: any;
  multiple?: boolean;
}) {
  return (
    <label>
      {title}
      <select name={name} defaultValue={value} required multiple={multiple}>
        {!multiple && <option value="">Select person</option>}
        {refs.people
          .filter((p: any) => p.role === role)
          .map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
      </select>
    </label>
  );
}
export function ApprovedQuoteSelect({
  refs,
  r,
  value,
  optional = false,
  template = false,
}: any) {
  return (
    <label>
      {optional
        ? "Revised approved quotation (optional)"
        : "Exact approved quotation version"}
      <select
        name="quotationId"
        defaultValue={optional ? "" : (value ?? "")}
        required={!optional}
      >
        <option value="">
          {optional
            ? "Keep original approved basis"
            : "Select approved quotation"}
        </option>
        {(refs.quotations ?? [])
          .filter(
            (q: any) =>
              template ||
              (q.customer_id === r.customerId &&
                q.site_code.toLowerCase() === r.siteCode.toLowerCase()),
          )
          .map((q: any) => (
            <option key={q.id} value={q.id}>
              {q.number} · v{q.version} · {q.site_name}
            </option>
          ))}
      </select>
    </label>
  );
}
export function FrameworkSelect({
  refs,
  r,
  optional = false,
  onChange,
  finalOnly = false,
}: any) {
  return (
    <label>
      Approved configuration / version
      <select
        name="frameworkId"
        onChange={(e) => onChange?.(e.target.value)}
        defaultValue={optional ? "" : (r.frameworkId ?? "")}
        required={!optional}
      >
        <option value="">
          {optional
            ? "Keep original approved basis"
            : "Select approved version"}
        </option>
        {refs.frameworks
          .filter(
            (f: any) =>
              f.customer_id === r.customerId &&
              (!finalOnly ||
                f.type !== "ubl-solar" ||
                f.pricing_stage === "Revised"),
          )
          .map((f: any) => (
            <option key={f.id} value={f.id}>
              {f.type==='ubl-solar'?'Solar with BESS · ':f.type==='ubl-bess-installation'?'BESS with installation · ':''}{f.configuration_key} · v{f.version}
            </option>
          ))}
      </select>
    </label>
  );
}
