import { Decimal } from "decimal.js";
import { money } from "../numbers.js";
const ptNames = [
  "Solar Panels",
  "Structure",
  "Inverter",
  "Batteries",
  "BMS",
  "EPC",
];
const epcNames = [
  "Electrical Labour",
  "Earthing Cost",
  "Deliveries",
  "Installation Cost",
];
export const markupPercent = (selling: any, cost: any) =>
  selling == null || cost == null || new Decimal(cost).lte(0)
    ? "Not available"
    : money(new Decimal(selling).sub(cost).div(cost).mul(100).toString()) + "%";
export function installationDays(entry: any) {
  if (!entry?.start || !entry?.end) return null;
  const start = Date.parse(entry.start),
    end = Date.parse(entry.end);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.floor((end - start) / 86400000) + 1
    : null;
}
export function ClosureIndicators({
  budget,
  actual,
  selling,
  average,
  entry,
}: {
  budget: string;
  actual: string | null;
  selling: string;
  average?: string | null;
  entry?: any;
}) {
  const variance = actual === null ? null : new Decimal(actual).sub(budget);
  const days = installationDays(entry);
  return (
    <div className="closure-indicators">
      <div>
        <span>Cost performance · excl. GST</span>
        <strong>
          {variance === null
            ? "Not entered"
            : `${money(variance.abs().toString())} ${variance.gt(0) ? "over budget" : "saved"}`}
        </strong>
        <small>
          {variance === null || new Decimal(budget).isZero()
            ? ""
            : money(variance.abs().div(budget).mul(100).toString()) +
              "% " +
              (variance.gt(0) ? "above" : "below") +
              " budget"}
        </small>
      </div>
      <div>
        <span>Budgeted / actual markup</span>
        <strong>
          {markupPercent(selling, budget)} / {markupPercent(selling, actual)}
        </strong>
        <small>Markup on cost</small>
      </div>
      <div>
        <span>Same-configuration closed average</span>
        <strong>
          {average == null ? "Not available" : money(average) + "%"}
        </strong>
        <small>
          {days === null ? "" : days + " installation days · inclusive"}
        </small>
      </div>
    </div>
  );
}
export function ClosureCostTables({
  job,
  actual,
  epc,
  epcAggregate,
  details,
  readonly,
  onActual,
  onEpc,
  onAggregate,
  onDetails,
}: {
  job: any;
  actual: Record<string, string>;
  epc: Record<string, string>;
  epcAggregate: string;
  details: boolean;
  readonly: boolean;
  onActual: (name: string, value: string) => void;
  onEpc: (name: string, value: string) => void;
  onAggregate: (value: string) => void;
  onDetails: (value: boolean) => void;
}) {
  const val = (v: string | undefined) =>
    v === undefined || v === "" ? null : new Decimal(v);
  const sum = (map: Record<string, string>, names: string[]) =>
    names.every((n) => val(map[n]) !== null)
      ? names.reduce((s, n) => s.add(map[n]), new Decimal(0))
      : null;
  const costs: Record<string, string> = { ...actual, EPC: epcAggregate };
  const budget = sum(job.budget, ptNames)!;
  const total = sum(costs, ptNames);
  const split = sum(epc, epcNames);
  const epcTotal = val(epcAggregate);
  const average = job.configurationComparison?.averageActualMarkupPercent;
  const cells = (name: string, b: any, a: Decimal | null, totalRow = false) => (
    <>
      <td className="pz-number">{name === "Total" ? money(job.selling)
        : name === "BESS subtotal" && job.phaseSelling && ["Inverter", "Batteries", "BMS"].every(p => job.phaseSelling[p] != null)
          ? money(["Inverter", "Batteries", "BMS"].reduce((v,p) => v.add(job.phaseSelling[p]), new Decimal(0)).toString())
          : job.phaseSelling?.[name] != null ? money(job.phaseSelling[name]) : "Not available"}</td>
      <td className="pz-number">{money(b)}</td>
      <td className="pz-number">
        {readonly || totalRow ? (
          a === null ? (
            "Not entered"
          ) : (
            money(a.toString())
          )
        ) : (
          <input
            aria-label={name + " actual cost"}
            id={name === "EPC" ? "closure-epc-total" : undefined}
            type="number"
            min="0"
            step="0.01"
            value={name === "EPC" ? epcAggregate : (actual[name] ?? "")}
            onChange={(e) =>
              name === "EPC"
                ? onAggregate(e.target.value)
                : onActual(name, e.target.value)
            }
          />
        )}
      </td>
      <td className="pz-number">
        {a === null ? "Not entered" : money(a.sub(b).toString())}
      </td>
      <td className="pz-number">
        {totalRow && name === "Total"
          ? markupPercent(job.selling, b)
          : markupPercent(name === "BESS subtotal"
              ? (job.phaseSelling && ["Inverter", "Batteries", "BMS"].every(p => job.phaseSelling[p] != null)
                  ? ["Inverter", "Batteries", "BMS"].reduce((v, p) => v.add(job.phaseSelling[p]), new Decimal(0)).toString() : null)
              : job.phaseSelling?.[name], b)}
      </td>
      <td className="pz-number">
        {totalRow && name === "Total"
          ? markupPercent(job.selling, a?.toString())
          : markupPercent(name === "BESS subtotal"
              ? (job.phaseSelling && ["Inverter", "Batteries", "BMS"].every(p => job.phaseSelling[p] != null)
                  ? ["Inverter", "Batteries", "BMS"].reduce((v, p) => v.add(job.phaseSelling[p]), new Decimal(0)).toString() : null)
              : job.phaseSelling?.[name], a?.toString())}
      </td>
      <td className="pz-number">
        {totalRow && name === "Total" && average != null
          ? money(average) + "%"
          : "Not available"}
      </td>
    </>
  );
  const headers = (
    <tr>
      <th>PT phase</th>
      <th>Agreed selling price<br />excl. GST</th>
      <th>
        Budgeted cost
        <br />
        excl. GST
      </th>
      <th>
        Actual cost
        <br />
        excl. GST
      </th>
      <th>Variance</th>
      <th>Budget markup %</th>
      <th>Actual markup %</th>
      <th>Average markup %</th>
    </tr>
  );
  return (
    <>
      <h3>PT phase performance · excluding GST</h3>
      <div className="table-scroll">
        <table className="closure-performance-table closure-pt-table">
          <thead>{headers}</thead>
          <tbody>
            {ptNames.slice(0, 5).map((p) => (
              <tr key={p}>
                <th>{p}</th>
                {cells(p, job.budget[p], val(costs[p]))}
              </tr>
            ))}
            <tr className="closure-subtotal">
              <th>BESS subtotal</th>
              {cells(
                "BESS subtotal",
                sum(job.budget, ptNames.slice(2, 5))!.toString(),
                sum(actual, ptNames.slice(2, 5)),
                true,
              )}
            </tr>
            <tr>
              <th>EPC</th>
              {cells("EPC", job.budget.EPC, val(epcAggregate))}
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              {cells("Total", budget.toString(), total, true)}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="helper-text">
        Variance is actual minus budget; negative amounts are savings. Phase
        markup requires an approved phase selling allocation. Closed average is
        total peer markup divided by total peer actual cost, excluding this job.
      </p>
      <label className="closure-details-toggle">
        <input
          type="checkbox"
          checked={details}
          disabled={readonly}
          onChange={(e) => onDetails(e.target.checked)}
        />
        Enter EPC actual cost details
      </label>
      {details ? (
        <>
          <h3>EPC actual cost details · excluding GST</h3>
          <div className="table-scroll">
            <table className="closure-performance-table">
              <thead>
                <tr>
                  <th>EPC category</th>
                  <th>
                    Budgeted cost
                    <br />
                    excl. GST
                  </th>
                  <th>
                    Actual cost
                    <br />
                    excl. GST
                  </th>
                  <th>Variance</th>
                  <th>Budget markup %</th>
                  <th>Actual markup %</th>
                  <th>Average markup %</th>
                </tr>
              </thead>
              <tbody>
                {epcNames.map((p) => (
                  <tr key={p}>
                    <th>{p}</th>
                    <td className="pz-number">{money(job.epcBudget[p])}</td>
                    <td className="pz-number">
                      {readonly ? (
                        epc[p] === "" || epc[p] === undefined ? (
                          "Not entered"
                        ) : (
                          money(epc[p])
                        )
                      ) : (
                        <input
                          aria-label={p + " actual cost"}
                          type="number"
                          min="0"
                          step="0.01"
                          value={epc[p] ?? ""}
                          onChange={(e) => onEpc(p, e.target.value)}
                        />
                      )}
                    </td>
                    <td className="pz-number">
                      {val(epc[p]) === null
                        ? "Not entered"
                        : money(val(epc[p])!.sub(job.epcBudget[p]).toString())}
                    </td>
                    <td>Not available</td>
                    <td>Not available</td>
                    <td>Not available</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>EPC total</th>
                  <td className="pz-number">{money(job.budget.EPC)}</td>
                  <td className="pz-number">
                    {split === null ? "Not entered" : money(split.toString())}
                  </td>
                  <td className="pz-number">
                    {split === null
                      ? "Not entered"
                      : money(split.sub(job.budget.EPC).toString())}
                  </td>
                  <td>Not available</td>
                  <td>Not available</td>
                  <td>Not available</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {split === null || epcTotal === null || !split.eq(epcTotal) ? (
            <p role="alert" className="form-error">
              EPC detail must match the PT EPC total.{" "}
              {split !== null && epcTotal !== null
                ? "Difference: PKR " + money(split.sub(epcTotal).toString())
                : "Enter all four categories and the EPC total."}
            </p>
          ) : (
            <p role="status">EPC detail matches the PT EPC total.</p>
          )}
        </>
      ) : (
        <p>Total EPC cost only · category breakup not provided.</p>
      )}
    </>
  );
}
