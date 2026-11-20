import { Decimal } from "decimal.js";
import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { decimalDisplay } from "../../numbers.js";
import { BessSelector } from "../../components/BessSelector.js";
import { confirmTransition } from "../../confirm.js";
import { ErrorText, Action, FrameworkSelect, Input } from "./parts.js";

export function QuickSurveyCableComparison({ session, detail }: any) {
  const r = detail.record;
  const [comparison, setComparison] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setComparison(undefined);
    setError("");
    void api<any>(`/project-workflow/${r.id}/preview`, {
      csrf: session.csrfToken,
      body: { kind: "quick-cables" },
    })
      .then((p) => {
        if (live) setComparison(p.cableComparison);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [r.id, r.version]);
  return (
    <section className="pz-panel pz-stack">
      <ErrorText error={error} />
      {comparison?.standardsReview?.needsReview && <p className="pz-survey-difference" role="status"><strong>Needs Review — UBL standards deviation</strong><br />{comparison.standardsReview.message}</p>}
      {comparison?.pending && <p>{comparison.pending}</p>}
      {comparison?.rows?.length > 0 && (
        <>
          <CableQuantityComparison
            rows={comparison.rows}
            title="Quick BOQ Cable Quantities"
            baselineLabel="Quick BOQ qty (m)"
          />
          <p>{comparison.notes}</p>
        </>
      )}
    </section>
  );
}
export function CableQuantityComparison({
  rows,
  title = "Cable Quantity Comparison",
  baselineLabel = "Standard qty (m)",
}: any) {
  const cables = rows
    .filter((row: any) => row.field.endsWith("(m)"))
    .filter((row: any) => {
      try {
        return (
          !new Decimal(row.approved).isZero() ||
          !new Decimal(row.entered).isZero()
        );
      } catch {
        return true;
      }
    });
  const difference = (row: any) => {
    try {
      const delta = new Decimal(row.entered).sub(row.approved);
      return delta.isZero()
        ? "0.00 m"
        : `${decimalDisplay(delta.abs().toString())} m ${delta.gt(0) ? "more" : "less"}`;
    } catch {
      return "N/A";
    }
  };
  return (
    <div className="pz-stack">
      <h3>{title}</h3>
      <div className="pz-table-scroll">
        <table className="pz-table">
          <thead>
            <tr>
              <th>Cable</th>
              <th>{baselineLabel}</th>
              <th>Survey qty (m)</th>
              <th>Net quantity change</th>
            </tr>
          </thead>
          <tbody>
            {cables.map((row: any) => (
              <tr
                key={row.field}
                className={row.different ? "pz-survey-difference" : undefined}
              >
                <th>{row.field.replace(/ \(m\)$/, "")}</th>
                <td>{decimalDisplay(row.approved)}</td>
                <td>{decimalDisplay(row.entered)}</td>
                <td>{difference(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Net quantity change = survey quantity − standard quantity.</p>
    </div>
  );
}
export function UblSurveyComparison({
  session,
  refs,
  detail,
  frameworkId,
  choose = false,
  onComparison,
}: any) {
  const r = detail.record;
  const [selected, setSelected] = useState(frameworkId ?? r.frameworkId ?? "");
  const [comparison, setComparison] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!choose) setSelected(frameworkId ?? "");
  }, [frameworkId, choose]);
  useEffect(() => {
    let live = true;
    setComparison(undefined);
    setError("");
    if (selected)
      void api<any>(`/project-workflow/${r.id}/preview`, {
        csrf: session.csrfToken,
        body: { kind: "framework", frameworkId: selected },
      })
        .then((p) => {
          if (live) { setComparison(p.surveyComparison); onComparison?.(p.surveyComparison); }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selected, r.id, r.version]);
  return (
    <section className="pz-panel pz-stack">
      <h3>Survey BOQ vs approved UBL BOQ</h3>
      {choose && (
        <label>
          Approved configuration for comparison
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select approved configuration / version</option>
            {refs.frameworks
              .filter(
                (f: any) =>
                  f.customer_id === r.customerId &&
                  (f.type !== "ubl-solar" || f.pricing_stage === "Revised"),
              )
              .map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.configuration_key} · v{f.version}
                </option>
              ))}
          </select>
        </label>
      )}
      {!selected && (
        <p>
          Select the exact approved configuration to compare the manually
          entered survey.
        </p>
      )}
      <ErrorText error={error} />
      {comparison?.pending && <p>{comparison.pending}</p>}
      {comparison?.rows?.length > 0 && (
        <>
          <p>Differences are shaded and labelled for technical review.</p>
          <div className="pz-table-scroll">
            <table className="pz-table">
              <thead>
                <tr>
                  <th>Item / requirement</th>
                  <th>Approved BOQ</th>
                  <th>Entered survey</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows
                  .filter((row: any) => !row.field.endsWith("(m)"))
                  .map((row: any) => (
                    <tr
                      key={row.field}
                      className={
                        row.different ? "pz-survey-difference" : undefined
                      }
                    >
                      <th>{row.field}</th>
                      <td>{row.approved}</td>
                      <td>{row.entered}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <CableQuantityComparison rows={comparison.rows} />
          <p>{comparison.notes}</p>
        </>
      )}
    </section>
  );
}
export function TechnicalReview({ session, refs, detail, action }: any) {
  const r = detail.record,
    s = detail.review?.survey ?? detail.record.data.surveyInputs ?? {},
    [selections, setSelections] = useState<Record<string, string>>(
      detail.review?.itemSelections ?? {},
    );
  const [selectedFramework, setSelectedFramework] = useState(
    r.frameworkId ?? "",
  );
  const [noFeasible, setNoFeasible] = useState(false);
  const [reviewRemarks, setReviewRemarks] = useState("");
  const [standardsFlag, setStandardsFlag] = useState<any>();
  const framework = r.route.endsWith("framework");
  const quantities: Record<string, string> = {
    panelQty: "Panel quantity",
    panelWattage: "Panel watts",
    dcMetres: "DC cable total metres",
    acInverter16: "16 mm² inverter cable metres",
    acPanel16: "16 mm² load cable metres",
    acPanel25: "25 mm² load cable metres",
    earth25: "2.5 mm² earth metres",
    earth6: "6 mm² earth metres",
    earth10: "10 mm² earth metres",
  };
  function review(f: FormData) {
    const parts = String(f.get("profile") ?? "standard-installation|1").split(
        "|",
      ),
      survey: any = {
        ...s,
        customerId: r.customerId,
        siteName: r.site,
        siteCode: r.siteCode,
        location: f.get("location") ?? "",
        family: f.get("family") ?? "solar-hybrid",
        sourceMode: "Survey",
        structure: f.get("structure") ?? "Elevated",
        bessId: f.get("bessId"),
        inverter: f.get("inverter"),
        batteryKwh: Number(f.get("batteryKwh") ?? 0),
        smartMeter: f.has("smartMeter"),
        genset: f.has("genset"),
        brands: { ...(s.brands ?? {}) },
        preparedBy: session.user.displayName,
      };
    for (const k of Object.keys(quantities))
      survey[k] = k === "panelQty" ? Number(f.get(k)) : String(f.get(k) ?? "0");
    return {
      frameworkId: framework
        ? f.get("frameworkId") || r.frameworkId
        : undefined,
      profileKey: parts[0],
      profileVersion: Number(parts[1]),
      itemSelections: selections,
      markups: Object.fromEntries(
        [...f.entries()]
          .filter(([k]) => k.startsWith("markup:"))
          .map(([k, v]) => [k.slice(7), String(v)]),
      ),
      notes: String(f.get("notes") ?? ""),
      ...(!framework ? { survey } : {}),
    };
  }
  return (
    <Action
      title="Technical Review"
      submitLabel="Submit Technical Review"
      onSubmit={async (f) => {
        if (noFeasible) {
          const notes = String(f.get("notes") ?? "").trim();
          if (!notes)
            throw new Error("Explain why no feasible solution is available.");
          if (
            !confirmTransition(
              "Submit — Needs Review",
              `Send ${r.customerCode} · ${r.site} to Atif marked Needs Review — No Feasible Solution?\n\n${notes}`,
            )
          )
            return false;
          await action("no-feasible-solution", { notes });
          return;
        }
        const input = review(f);
        if (
          !confirmTransition(
            "Submit Technical Review",
            `Mark ${r.customerCode} · ${r.site} (${r.siteCode}) as technically reviewed and share to Coordination?\nThis saves the technical review and moves the project to Submitted to Coordination.`,
          )
        )
          return false;
        await action("submit-technical-review", input);
      }}
    >
      <label className="pz-review-check">
        <input
          type="checkbox"
          checked={noFeasible}
          onChange={(e) => setNoFeasible(e.target.checked)}
        />
        No Feasible Solution
      </label>
      {noFeasible && (
        <p>
          This survey and all entered details will be shared to Atif marked
          Needs Review.
        </p>
      )}
      {!noFeasible && (
        <>
          <p>
            {framework
              ? "Select the solution family and approved configuration after reviewing the survey. UBL options include Solar with BESS and BESS with installation; approved rates stay fixed."
              : "Review the approved engineering rules, configuration and survey quantities."}
          </p>
          {framework ? (
            <>
              <FrameworkSelect
                {...{ refs, r }}
                finalOnly
                onChange={setSelectedFramework}
              />
              {r.customerCode?.toUpperCase() === "UBL" &&
                r.route === "survey-framework" && (
                  <UblSurveyComparison
                    {...{ session, refs, detail }}
                    frameworkId={selectedFramework}
                    onComparison={(comparison: any) => {
                      setStandardsFlag(comparison?.standardsReview);
                      const message = "Not in line with agreed UBL standards. Please discuss with UBL Management.";
                      setReviewRemarks((existing: string) => {
                        const manual = existing.replace(message, "").trim();
                        return comparison?.standardsReview?.needsReview ? [manual, message].filter(Boolean).join("\n") : manual;
                      });
                    }}
                  />
                )}
            </>
          ) : (
            <>
              <div className="pz-form-grid">
                <label>
                  Approved engineering profile
                  <select name="profile">
                    {refs.profiles
                      .filter(
                        (p: any) =>
                          p.key === "standard-installation" ||
                          p.payload.customerShortCode === r.customerCode,
                      )
                      .map((p: any) => (
                        <option key={p.key} value={`${p.key}|${p.version}`}>
                          {p.key} · v{p.version}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Solution family
                  <select
                    name="family"
                    defaultValue={s.family ?? "solar-hybrid"}
                  >
                    <option value="solar-hybrid">Solar hybrid</option>
                    <option value="bess-only">BESS / UPS only</option>
                  </select>
                </label>
                <Input
                  name="location"
                  title="Location"
                  value={s.location ?? r.region}
                />
                <BessSelector initial={s} />
                <label>
                  Structure
                  <select
                    name="structure"
                    defaultValue={s.structure ?? "Elevated"}
                  >
                    {["L1", "L2", "L3", "Elevated"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                {Object.entries(quantities).map(([k, n]) => (
                  <Input
                    key={k}
                    name={k}
                    title={n}
                    type="number"
                    value={s[k] ?? "0"}
                    required
                  />
                ))}
              </div>
              <label>
                <input
                  name="smartMeter"
                  type="checkbox"
                  defaultChecked={s.smartMeter}
                />{" "}
                Additional smart meter
              </label>
              <label>
                <input
                  name="genset"
                  type="checkbox"
                  defaultChecked={s.genset}
                />{" "}
                Genset synchronisation
              </label>
            </>
          )}
        </>
      )}
      <label>
        {noFeasible
          ? "Reason no feasible solution is available"
          : "Technical verification and remarks"}
        <textarea name="notes" required value={reviewRemarks} onChange={(e) => setReviewRemarks(e.target.value)} />
        {!noFeasible && standardsFlag?.needsReview && <p className="pz-survey-difference" role="status"><strong>Needs Review — UBL standards deviation</strong><br />This flag is retained when the review is submitted to Atif.</p>}
      </label>
    </Action>
  );
}
