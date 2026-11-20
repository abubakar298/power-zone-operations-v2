import { ErrorText, label, Action, Input } from "./parts.js";
import { Decimal } from "decimal.js";
import { confirmLeaveWorkspace } from "../../hooks/useUnsavedChanges.js";
import { useState } from "react";
import { Button } from "../../ui/Button.js";
import { Field } from "../../ui/Field.js";
import { DocumentPreview } from "../../components/DocumentPreview.js";
import { decimalDisplay } from "../../numbers.js";
import { WorkspaceFilters, emptyWorkspaceFilters, matchesWorkspace } from "../../components/WorkspaceFilters.js";
import { confirmTransition } from "../../confirm.js";
import { SitePicturesFolder } from "./SurveyAttachments.js";
import { StandardSurveyBoqInputs, CustomerSurveyForm } from "./CustomerSurveyForm.js";

export function SurveyReviewInputs({
  session,
  refs,
  detail,
  action,
  canEdit = true,
}: any) {
  const r = detail.record;
  const reports = (detail.files ?? []).filter(
    (file: any) => file.kind === "Survey report",
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(reports[0]?.id ?? "");
  const file = reports.find((f: any) => f.id === selected);
  const observations =
    r.data.customerSurveyForms?.["ubl-solar-survey"]?.values ?? {};
  const observed = (key: string, unit: string) =>
    observations[key] == null || observations[key] === ""
      ? "N/A"
      : `${decimalDisplay(observations[key])} ${unit}`;
  const savedInputs = r.data.surveyInputs;
  const inputs = savedInputs ? { ...savedInputs } : undefined;
  if (inputs) {
    inputs.totalWattage =
      inputs.panelQty != null &&
      inputs.panelWattage !== "" &&
      inputs.panelWattage != null
        ? `${decimalDisplay(new Decimal(inputs.panelQty).mul(inputs.panelWattage).toString(), 0)} W`
        : "Not entered";
    const sp = inputs.inverter === "6 kW SP",
      dual = String(inputs.inverter ?? "").startsWith("2×");
    const cable = (keys: string[], sizes: string[], fallback: number) => {
      const used = keys
        .map((key, index) => ({ qty: inputs[key], size: sizes[index] }))
        .filter(
          (row) =>
            row.qty != null && row.qty !== "" && new Decimal(row.qty).gt(0),
        );
      if (used.length)
        return used
          .map((row) => `${row.size} · ${decimalDisplay(row.qty)} m`)
          .join("; ");
      return `${sizes[fallback]} · ${decimalDisplay(inputs[keys[fallback]])} m`;
    };
    inputs.inverterCable = sp
      ? cable(["spInverterTerminationMetres"], ["10mm² 1-core"], 0)
      : cable(
          ["acInverter16", "acInverter25"],
          ["16mm² 4-core", "25mm² 4-core"],
          0,
        );
    inputs.loadCable = sp
      ? cable(["spLoadPanelRunMetres"], ["10mm² 1-core, per conductor run"], 0)
      : cable(
          ["acPanel16", "acPanel25"],
          ["16mm² 4-core", "25mm² 4-core"],
          dual ? 1 : 0,
        );
  }
  const fields = [
    ["family", "Solution family"],
    ["panelQty", "Panel quantity"],
    ["panelWattage", "Panel wattage (W)"],
    ["totalWattage", "Total wattage"],
    ["bessId", "BESS configuration"],
    ["inverter", "Inverter capacity"],
    ["batteryKwh", "Battery capacity (kWh)"],
    ["structure", "Structure"],
    ["dcMetres", "DC cable combined (m)"],
    ["inverterCable", "Inverter cable"],
    ["loadCable", "Load cable"],
    ["earth25", "2.5mm² earth cable (m)"],
    ["earth6", "6mm² earth cable (m)"],
    ["earth10", "10mm² earth cable (m)"],
    ["spIncludeEarthingBore", "Include Earthing Bore?"],
    ["smartMeter", "Extra smart meter"],
    ["genset", "Genset synchronisation"],
  ];
  return (
    <>
      <section className="pz-panel pz-stack">
        <Button
          variant="secondary"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Uploaded Survey Form
        </Button>
        {open && (
          <>
            {reports.length > 1 && (
              <label>
                Survey report file
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {reports.map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.filename}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {file ? (
              <DocumentPreview
                key={file.id}
                url={`/api/project-workflow/${r.id}/files/${file.id}`}
                title={file.filename}
                mime={file.mime}
              />
            ) : (
              <p>No uploaded survey report is linked to this request.</p>
            )}
          </>
        )}
      </section>
      <section className="pz-panel pz-stack">
        <SitePicturesFolder session={session} record={r} readOnly/>
        <h3>Standard BOQ Inputs</h3>
        {canEdit && (
          <Button
            variant="secondary"
            onClick={() => {
              if (editing && !confirmLeaveWorkspace()) return;
              setEditing(!editing);
            }}
          >
            {editing ? "Cancel Editing" : "Edit BOQ Inputs"}
          </Button>
        )}
        {editing ? (
          <StandardSurveyBoqInputs
            key={r.version}
            {...{ session, refs, detail }}
            reviewMode
            action={async (name: string, input: any) => {
              await action(name, input);
              setEditing(false);
            }}
          />
        ) : inputs ? (
          <div className="pz-table-scroll">
            <table className="pz-table">
              <tbody>
                {fields
                  .filter(([key]) => inputs[key] != null)
                  .map(([key, title]) => (
                    <tr key={key}>
                      <th>{title}</th>
                      <td>
                        {typeof inputs[key] === "boolean"
                          ? inputs[key]
                            ? "Yes"
                            : "No"
                          : inputs[key] === ""
                            ? "Not entered"
                            : key === "family"
                              ? label(inputs[key])
                              : String(inputs[key])}
                      </td>
                      <td>
                        {key === "panelQty" && (
                          <div>
                            <span>Available roof space</span>
                            <br />
                            <strong>{observed("roofSpace", "sq. ft.")}</strong>
                          </div>
                        )}
                        {key === "panelWattage" && (
                          <div>
                            <Button variant="secondary" disabled>
                              Check Stock Availability
                            </Button>
                            <small>
                              N/A — live warehouse balances are not connected.
                            </small>
                          </div>
                        )}
                        {key === "bessId" && (
                          <span>Confirm from genset and connected load</span>
                        )}
                        {key === "batteryKwh" && (
                          <span>Check load shedding schedule</span>
                        )}
                        {key === "inverter" && (
                          <div className="pz-boq-review-context">
                            <div>
                              <span>Genset capacity</span>
                              <br />
                              <strong>{observed("gensetKva", "kVA")}</strong>
                            </div>
                            <div>
                              <span>Connected load</span>
                              <br />
                              <strong>{observed("connectedLoad", "kW")}</strong>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Standard BOQ inputs have not been saved.</p>
        )}
      </section>
    </>
  );
}
export function SurveyCompletion({ session, refs, detail, action }: any) {
  const [standardOpen, setStandardOpen] = useState(true);
  const [customerFormOpen, setCustomerFormOpen] =
    useState<string>("ubl-solar-survey");
  const r = detail.record;
  const ubl =
    r.customerCode?.toUpperCase() === "UBL" && r.route === "survey-framework" && r.data.frameworkFamily!=="bess-only";
  const customerForms = (refs.surveyFormTemplates ?? []).filter(
    (template: any) =>
      r.route === "survey-framework" &&
      template.customerCode.toUpperCase() === r.customerCode.toUpperCase() && r.data.frameworkFamily!=="bess-only",
  );
  return (
    <section className="pz-panel pz-stack">
      <h3>Completion Report</h3>
      {r.data.surveyReading && (
        <details className="pz-panel" open>
          <summary>
            Read from attached survey reports — review before saving
          </summary>
          <p>
            {r.data.surveyReading.method} ·{" "}
            {r.data.surveyReading.sourceFileIds.length} report pages. No master
            records or engineering approvals were changed.
          </p>
          {r.data.surveyReading.flags.length > 0 && (
            <ul>
              {r.data.surveyReading.flags.map((flag: string) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      <Button
        variant="secondary"
        aria-expanded={standardOpen}
        aria-controls={`standard-survey-boq-${r.id}`}
        onClick={() => setStandardOpen(!standardOpen)}
      >
        Standard BOQ Input Form
      </Button>
      {(standardOpen || ubl) && (
        <div hidden={!standardOpen} id={`standard-survey-boq-${r.id}`}>
          <StandardSurveyBoqInputs
            key={r.data.surveyInputsSavedAt ?? r.id}
            session={session}
            refs={refs}
            detail={detail}
            action={action}
          />
        </div>
      )}
      {ubl && (
        <div className="pz-form-grid">
          <Field id={`ubl-completion-date-${r.id}`} label="Actual survey date">
            <input
              id={`ubl-completion-date-${r.id}`}
              name="date"
              type="date"
              form={`ubl-survey-form-${r.id}`}
              defaultValue={r.data.actualSurveyDate ?? ""}
            />
          </Field>
          <Field
            id={`ubl-completion-remarks-${r.id}`}
            label="Submission remarks"
          >
            <textarea
              id={`ubl-completion-remarks-${r.id}`}
              name="notes"
              form={`ubl-survey-form-${r.id}`}
              defaultValue={r.data.submissionRemarks ?? ""}
            />
          </Field>
        </div>
      )}
      {customerForms.map((template: any) => (
        <div key={template.key} className="pz-stack">
          <Button
            variant="secondary"
            aria-expanded={customerFormOpen === template.key}
            aria-controls={`customer-survey-${r.id}-${template.key}`}
            onClick={() =>
              setCustomerFormOpen(
                customerFormOpen === template.key ? undefined : template.key,
              )
            }
          >
            {template.payload.label}
          </Button>
          {(ubl || customerFormOpen === template.key) && (
            <div
              hidden={customerFormOpen !== template.key}
              id={`customer-survey-${r.id}-${template.key}`}
            >
              <CustomerSurveyForm
                key={
                  r.data.customerSurveyDrafts?.[template.key]?.savedAt ??
                  r.data.customerSurveyForms?.[template.key]?.savedAt ??
                  template.key
                }
                session={session}
                refs={refs}
                detail={detail}
                template={template}
                action={action}
              />
            </div>
          )}
        </div>
      ))}
      {r.data.surveyInputsSavedAt && (
        <p role="status">Standard BOQ inputs saved for technical review.</p>
      )}
      {!ubl && (
        <Action
          formId={`report-submit-${r.id}`}
          disabled={ubl && !r.data.customerSurveyForms?.["ubl-solar-survey"]}
          title="Complete Submission"
          onSubmit={async (f) => {
            const savedBoq = r.data.surveyInputs;
            if (!savedBoq)
              throw new Error(
                "Complete and save the survey BOQ before sending for technical review.",
              );
            const summary = `${r.customerCode} · ${r.site} (${r.siteCode})\nSurvey date: ${f.get("date")}\nPanels: ${savedBoq.panelQty} × ${savedBoq.panelWattage} W\nBESS: ${savedBoq.bessId ?? "Not entered"}\nDC cable: ${savedBoq.dcMetres} m\nStructure: ${savedBoq.structure}\n${ubl ? "UBL details: saved\n" : ""}Remarks: ${f.get("notes")}`;
            if (
              !confirmTransition(
                "Review & Send for Technical Review",
                `${summary}\n\nSend the saved survey from Scheduled Surveys to Technical Review?`,
              )
            )
              return false;
            await action("report", {
              date: f.get("date"),
              notes: f.get("notes"),
            });
          }}
        >
          {!ubl && (
            <>
              <Input
                name="date"
                title="Actual survey date"
                type="date"
                value={r.data.actualSurveyDate || ""}
                required
              />
              <Field id={`completion-remarks-${r.id}`} label="Remarks">
                <textarea
                  id={`completion-remarks-${r.id}`}
                  name="notes"
                  required
                />
              </Field>
            </>
          )}
          {ubl && !r.data.customerSurveyForms?.["ubl-solar-survey"] && (
            <p>Fill and save all UBL survey details before submitting.</p>
          )}
          <p>
            Attach the completed survey report and site pictures above before
            submitting. Saved BOQ inputs stay linked to this survey.
          </p>
        </Action>
      )}
    </section>
  );
}
export function AwaitingSurveyRequests({ records = [], onOpen }: any) {
  const [filters, setFilters] = useState({ ...emptyWorkspaceFilters });
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string>();
  const [errorRecord, setErrorRecord] = useState<string>();
  const pending = records
    .filter(
      (r: any) =>
        ["survey_requested", "survey_scheduled"].includes(r.stage) &&
        !r.data.surveyDispatchId,
    )
    .map((r: any) => ({
      ...r,
      siteLabel: r.site,
      site: `${r.site} ${r.siteCode}`,
      reference: [r.siteCode, r.id, ...(r.references ?? [])].join(" "),
    }));
  const visible = pending.filter((r: any) => matchesWorkspace(r, filters));
  return (
    <section className="pz-panel pz-stack">
      <h3>Survey requests awaiting scheduling or dispatch</h3>
      <WorkspaceFilters
        rows={pending}
        value={filters}
        onChange={setFilters}
        compact
        showTaskModes={false}
        searchLabel="Search survey requests"
      />
      <div className="pz-table-scroll">
        <table className="pz-table">
          <thead>
            <tr>
              <th>Customer / site</th>
              <th>Next step</th>
              <th>Saved survey date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r: any) => (
              <tr key={r.id}>
                <td>
                  {r.customerCode} · {r.siteLabel} ({r.siteCode})
                </td>
                <td>
                  {r.stage === "survey_requested"
                    ? "Needs scheduling"
                    : "Schedule saved — needs dispatch"}
                </td>
                <td>{r.data.scheduledSurveyDate || "Not scheduled"}</td>
                <td>
                  <Button
                    variant="secondary"
                    loading={opening === r.id}
                    onClick={async () => {
                      setError("");
                      setErrorRecord(undefined);
                      setOpening(r.id);
                      try {
                        await onOpen(r.id);
                      } catch (e) {
                        setError((e as Error).message);
                        setErrorRecord(r.id);
                      } finally {
                        setOpening(undefined);
                      }
                    }}
                  >
                    {r.stage === "survey_requested"
                      ? "Schedule & Assign Surveyors"
                      : "Create / Assign Dispatch"}
                  </Button>
                  {error && errorRecord === r.id && <ErrorText error={error} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>No requests match these filters.</p>}
    </section>
  );
}
