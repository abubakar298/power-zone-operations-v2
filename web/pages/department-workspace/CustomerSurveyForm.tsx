import { Action } from "./parts.js";
import { roundedSurveyCableMetres } from "../../../shared/survey-cables.js";
import { surveySharedValues } from "../../../server/project-workflow/survey-shared-values.js";
import { useMemo, useState } from "react";
import { Field } from "../../ui/Field.js";
import { SurveyQuantityFields } from "../../components/SurveyQuantityFields.js";
import { confirmTransition } from "../../confirm.js";

export function CustomerSurveyForm({ session, refs, detail, template, action }: any) {
  const r = detail.record;
  const saved = r.data.customerSurveyForms?.[template.key];
  const [values, setValues] = useState<any>(
    r.data.customerSurveyDrafts?.[template.key]?.values ??
      saved?.values ??
      r.data.surveyReading?.customerFormValues ??
      {},
  );
  const standard =
    r.data.surveyInputs ?? r.data.surveyReading?.standardInputs ?? {};
  const master = detail.masterReview;
  const shared: any = surveySharedValues(
    standard,
    master.customer,
    master.site,
    (r.data.surveyTeam ?? [])
      .map(
        (id: string) =>
          (refs.surveyors ?? refs.people).find((p: any) => p.id === id)
            ?.display_name ?? "Unconfirmed surveyor",
      )
      .join(", "),
  );
  const fields = template.payload.fields.filter(
    (field: any) =>
      ![
        "customerName",
        "branchCode",
        "branchName",
        "address",
        "contact",
        "phone",
        "email",
        "vendor",
      ].includes(field.key),
  );
  return (
    <Action
      formId={`ubl-survey-form-${r.id}`}
      title={template.payload.label}
      submitLabel="Save Only"
      alternateSubmitLabel="Save and Complete Submission"
      onSubmit={async (f, intent) => {
        const entries: any = {};
        for (const field of fields) {
          if (field.type === "load-table") {
            entries[field.key] = field.items.map(
              (_: string, index: number) => ({
                quantity: String(f.get(`${field.key}-${index}-quantity`) ?? ""),
                estimatedKw: String(
                  f.get(`${field.key}-${index}-estimatedKw`) ?? "",
                ),
                totalKw: String(f.get(`${field.key}-${index}-totalKw`) ?? ""),
              }),
            );
          } else entries[field.key] = String(f.get(field.key) ?? "");
        }
        const standardForm = document.getElementById(
          `standard-boq-form-${r.id}`,
        );
        if (!(standardForm instanceof HTMLFormElement))
          throw new Error("Open the Standard BOQ Input Form before saving.");
        if (!standardForm.checkValidity())
          throw new Error(
            "Complete the Standard BOQ Input Form above, then save both forms together.",
          );
        const input = standardSurveySaveInput(
          new FormData(standardForm),
          detail,
          session,
          r.data.surveyInputs ?? {},
        );
        const completeSubmission = intent === "complete";
        const date = String(f.get("date") ?? "");
        const notes = String(f.get("notes") ?? "").trim();
        if (completeSubmission) {
          if (!date || !notes)
            throw new Error(
              "Enter the actual survey date and submission remarks above before completing submission.",
            );
          const summary = `${r.customerCode} · ${r.site} (${r.siteCode})\nSurvey date: ${date}\nPanels: ${input.survey.panelQty} × ${input.survey.panelWattage} W\nBESS: ${input.survey.bessId ?? "Not entered"}\nUBL details: complete\nRemarks: ${notes}`;
          if (
            !confirmTransition(
              "Save and Complete Submission",
              `${summary}\n\nSave these current inputs and send to Technical Review?`,
            )
          )
            return false;
        }
        await action("save-survey-completion", {
          ...input,
          customerForm: {
            templateKey: template.key,
            templateVersion: template.version,
            values: entries,
          },
          completeSubmission,
          date,
          notes,
        });
      }}
    >
      <p>
        Enter the additional UBL observations from the Multan Surveys sheet.
        Connected load is entered as reported; calculation rules will be added
        later.
      </p>
      {r.data.customerSurveyDrafts?.[template.key] && (
        <p role="status">
          Sample values for local walkthrough — review and save. These are not
          verified site findings.
        </p>
      )}
      {saved && (
        <p role="status">
          UBL survey details saved for Solution Engineer review.
        </p>
      )}
      {[...new Set<string>(fields.map((field: any) => field.group))].map(
        (group) => (
          <fieldset className="pz-customer-survey-group" key={group}>
            <legend>{group}</legend>
            <div className="pz-form-grid">
              {fields
                .filter(
                  (field: any) =>
                    field.group === group && field.type !== "load-table",
                )
                .map((field: any) => {
                  const id = `ubl-field-${r.id}-${field.key}`;
                  const value = field.shared
                    ? String(shared[field.shared] ?? "")
                    : (values[field.key] ?? "");
                  return (
                    <Field
                      key={field.key}
                      id={id}
                      label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`}
                      hint={
                        field.shared ? "Autofilled from shared records" : ""
                      }
                    >
                      {field.shared ? (
                        <input
                          id={id}
                          name={field.key}
                          value={value}
                          readOnly
                        />
                      ) : field.type === "select" ? (
                        <select
                          required
                          id={id}
                          name={field.key}
                          value={value}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        >
                          <option value="">Not entered</option>
                          {[...new Set<string>([...field.options, ...(field.key === "property" ? ["N/A"] : [])])].map((option: string) => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      ) : field.type === "textarea" ? (
                        <textarea
                          required
                          id={id}
                          name={field.key}
                          value={value}
                          maxLength={4000}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      ) : (
                        <input
                          required
                          id={id}
                          name={field.key}
                          type={
                            field.shared
                              ? "text"
                              : ["number", "integer"].includes(field.type)
                                ? "number"
                                : field.type === "date"
                                  ? "date"
                                  : "text"
                          }
                          min={
                            ["number", "integer"].includes(field.type)
                              ? 0
                              : undefined
                          }
                          step={
                            field.type === "integer"
                              ? 1
                              : field.type === "number"
                                ? 0.0001
                                : undefined
                          }
                          value={value}
                          readOnly={!!field.shared}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [field.key]: e.target.value,
                            })
                          }
                        />
                      )}
                    </Field>
                  );
                })}
            </div>
            {fields
              .filter(
                (field: any) =>
                  field.group === group && field.type === "load-table",
              )
              .map((field: any) => (
                <div className="pz-table-scroll" key={field.key}>
                  <table className="pz-table">
                    <thead>
                      <tr>
                        <th>Equipment</th>
                        <th>Quantity</th>
                        <th>Reported estimated load (kW)</th>
                        <th>Reported total load (kW)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {field.items.map((equipment: string, index: number) => (
                        <tr key={equipment}>
                          <td>{equipment}</td>
                          {["quantity", "estimatedKw", "totalKw"].map(
                            (column) => (
                              <td key={column}>
                                <input
                                  aria-label={`${equipment} ${column}`}
                                  name={`${field.key}-${index}-${column}`}
                                  type="number"
                                  min={0}
                                  step={column === "quantity" ? 1 : 0.0001}
                                  defaultValue={
                                    values[field.key]?.[index]?.[column] ?? ""
                                  }
                                />
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </fieldset>
        ),
      )}
    </Action>
  );
}
export function CustomerSurveySummary({ refs, detail }: any) {
  const saved = detail.record.data.customerSurveyForms ?? {};
  return (
    <>
      {Object.entries(saved).map(([key, form]: any) => {
        const template = (refs.surveyFormTemplates ?? []).find(
          (t: any) => t.key === key && t.version === form.templateVersion,
        );
        if (!template) return null;
        return (
          <details className="pz-panel" key={key}>
            <summary>
              {template.payload.label} — saved survey observations
            </summary>
            <p>
              Connected load is manually reported; no automatic sizing
              calculation has been applied.
            </p>
            <div className="pz-table-scroll">
              <table className="pz-table">
                <tbody>
                  {template.payload.fields
                    .filter(
                      (field: any) =>
                        field.type !== "load-table" &&
                        form.values[field.key] !== "" &&
                        form.values[field.key] != null,
                    )
                    .map((field: any) => (
                      <tr key={field.key}>
                        <th>
                          {field.label}
                          {field.unit ? ` (${field.unit})` : ""}
                        </th>
                        <td>{form.values[field.key]}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {template.payload.fields
              .filter((field: any) => field.type === "load-table")
              .map((field: any) => (
                <div className="pz-table-scroll" key={field.key}>
                  <table className="pz-table">
                    <thead>
                      <tr>
                        <th>Equipment</th>
                        <th>Quantity</th>
                        <th>Estimated load (kW)</th>
                        <th>Reported total (kW)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(form.values[field.key] ?? [])
                        .filter(
                          (row: any) =>
                            row.quantity !== "" ||
                            row.estimatedKw !== "" ||
                            row.totalKw !== "",
                        )
                        .map((row: any) => (
                          <tr key={row.equipment}>
                            <td>{row.equipment}</td>
                            <td>{row.quantity || "Not entered"}</td>
                            <td>{row.estimatedKw || "Not entered"}</td>
                            <td>{row.totalKw || "Not entered"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </details>
        );
      })}
    </>
  );
}
export function standardSurveySaveInput(
  f: FormData,
  detail: any,
  session: any,
  initial: any,
) {
  const r = detail.record;
  const family = String(f.get("family"));
  const quantityKeys = [
    "dcMetres",
    "acInverter16",
    "acInverter25",
    "acPanel16",
    "acPanel25",
    "earth25",
    "earth6",
    "earth10",
  ];
  const bessOnly = family === "bess-only";
  const survey: any = {
    family,
    sourceMode: "Survey",
    acTerminationMode: "Measured",
    customerId: r.customerId,
    siteName: r.site,
    siteCode: r.siteCode,
    location: detail.masterReview.site.location ?? r.data.siteAddress ?? "",
    panelQty: bessOnly ? 0 : Number(f.get("panelQty")),
    panelWattage: bessOnly ? "0" : String(f.get("panelWattage") ?? ""),
    structure: bessOnly ? "L1" : String(f.get("structure")),
    bessId: f.get("bessId") || undefined,
    inverter: String(f.get("inverter") ?? ""),
    batteryKwh: Number(f.get("batteryKwh")),
    smartMeter: f.get("smartMeter") === "yes",
    genset: f.get("genset") === "yes",
    spIncludeEarthingBore: f.has("spIncludeEarthingBore"),
    brands: Object.fromEntries(
      ["solar", "inverter", "battery", "cable", "switchgear"].map((k) => [
        k,
        initial.brands?.[k] ?? 0,
      ]),
    ),
    preparedBy: session.user.displayName,
  };
  for (const key of quantityKeys) survey[key] = String(f.get(key) || "0");
  if (bessOnly) {
    survey.dcMetres = "0";
    survey.earth25 = "0";
  }
  if (f.get("spInverterTerminationMetres"))
    survey.spInverterTerminationMetres = String(
      f.get("spInverterTerminationMetres"),
    );
  if (f.get("spLoadPanelTotalMetres"))
    survey.spLoadPanelRunMetres = String(
      Number(f.get("spLoadPanelTotalMetres")) / 2,
    );
  if(detail.record.customerCode?.toUpperCase()==='UBL'&&detail.record.route==='survey-framework') {
    for(const key of ['dcMetres','acInverter16','acInverter25','acPanel16','acPanel25','earth25','earth6','earth10','spInverterTerminationMetres','spLoadPanelRunMetres']) {
      if(survey[key]!=null&&survey[key]!=='')survey[key]=roundedSurveyCableMetres(key,survey[key]);
    }
  }
  const master = detail.masterReview;
  const masterDetails = {
    customerName: master.customer.name,
    siteName: master.site.name,
    address: master.site.location ?? "",
  };
  return {
    survey,
    masterDetails,
    confirmMasterChange: false,
    customerVersion: master.customer.version,
    siteVersion: master.site.version,
  };
}
export function StandardSurveyBoqInputs({
  session,
  refs,
  detail,
  action,
  reviewMode = false,
}: any) {
  const r = detail.record;
  const manual =
    r.customerCode?.toUpperCase() === "UBL" && r.route === "survey-framework" && r.data.frameworkFamily!=="bess-only";
  const initial = useMemo(
    () =>
      r.data.surveyInputs ?? r.data.agreedSurveyInputs ??
      (manual
        ? { bessId: "", sourceMode: "Survey", acTerminationMode: "Measured" }
        : (r.data.surveyReading?.standardInputs ?? {
            sourceMode: "Survey",
            acTerminationMode: "Measured",
            location: r.data.siteAddress || r.region,
          })),
    [
      r.id,
      r.data.surveyInputs,
      r.data.surveyReading,
      r.data.siteAddress,
      r.region,
    ],
  );
  const [patch] = useState<Record<string, string>>({});
  const [family, setFamily] = useState(
    initial.family ?? (manual ? "" : "solar-hybrid"),
  );
  const [inverter, setInverter] = useState(
    initial.inverter ?? (manual ? "" : "10 kW"),
  );
  return (
    <Action
      formId={`standard-boq-form-${r.id}`}
      hideSubmit={manual && !reviewMode}
      title="Standard BOQ Input Form"
      submitLabel={reviewMode ? "Save Reviewed BOQ Inputs" : "Save BOQ Inputs"}
      onSubmit={async (f) => {
        if (manual && !reviewMode) return false;
        await action(
          reviewMode ? "review-survey-inputs" : "save-survey-inputs",
          standardSurveySaveInput(f, detail, session, initial),
        );
      }}
    >
      {manual && (
        <p>
          Enter the measured survey values manually. Differences from the
          approved UBL BOQ will be highlighted in Technical Review.
        </p>
      )}
      <div className="survey-grid">
        <label>
          Solution family
          <select
            name="family"
            aria-label="Solution family"
            required
            value={family}
            onChange={(e) => setFamily(e.target.value)}
          >
            {manual && <option value="">Select solution family</option>}
            <option value="solar-hybrid">Solar Hybrid</option>
            <option value="bess-only">BESS / UPS only</option>
          </select>
        </label>
        <div aria-hidden="true" />
      </div>
      <SurveyQuantityFields
        key={family}
        initial={initial}
        patch={patch}
        quick={false}
        manual={manual}
        inverter={inverter}
        onInverter={setInverter}
        bessOnly={family === "bess-only"}
      />
      <p className="pz-caption">
        Brand selection will be completed by Atif during BOQ preparation.
      </p>
    </Action>
  );
}
