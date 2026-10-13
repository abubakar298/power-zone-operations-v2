import { useState } from "react";
import {
  WorkspaceFilters,
  emptyWorkspaceFilters,
  matchesWorkspace,
} from "./WorkspaceFilters.js";
import { Field } from "../ui/Field.js";
import { Button } from "../ui/Button.js";
export function PoReceiptSearch({ records, onConfirm }: any) {
  const [filters, setFilters] = useState({ ...emptyWorkspaceFilters }),
    [headsOnly, setHeadsOnly] = useState("all");
  const candidates = records
    .filter((r: any) => r.stage === "customer_tracking")
    .map((r: any) => ({
      ...r,
      site: `${r.site} (${r.siteCode})`,
      reference: r.quotation?.number ?? r.references.join(" "),
      kind: r.quotation ? "Quotation" : "UBL survey / recommendation",
      customer: r.customer,
      original: r,
    }));
  const visible = candidates.filter(
    (r: any) =>
      matchesWorkspace(r, filters) &&
      (headsOnly !== "yes" || r.data.headsupReceived),
  );
  return (
    <section className="pz-panel pz-stack">
      <h3>Sent Quotations &amp; UBL Surveys</h3>
      <WorkspaceFilters
        rows={candidates}
        value={filters}
        onChange={setFilters}
        compact
        showTaskModes={false}
        searchLabel="Search quotations, surveys or sites"
        extraFilters={
          <Field id="po-headsup-filter" label="Heads-up Sites">
            <select
              id="po-headsup-filter"
              value={headsOnly}
              onChange={(e) => setHeadsOnly(e.target.value)}
            >
              <option value="all">All follow-up sites</option>
              <option value="yes">Heads-up received only</option>
            </select>
          </Field>
        }
      />
      <div className="pz-table-scroll">
        <table className="pz-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Site / branch code</th>
              <th>Approved document</th>
              <th>Heads-up</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r: any) => (
              <tr key={r.id}>
                <td>{r.customer}</td>
                <td>{r.site}</td>
                <td>{r.quotation?.number ?? r.kind}</td>
                <td>
                  {r.data.headsupReceived ? (
                    <span className="pz-headsup-tag">Heads-up Received</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <Button variant="secondary" onClick={() => onConfirm(r.id)}>
                    Confirm Sale
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>No follow-up sites match these filters.</p>}
    </section>
  );
}
