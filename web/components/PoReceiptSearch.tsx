import {DocumentListDetails} from './DocumentListDetails.js';
import {coordinationBuckets} from "../workspaces/project-routes.js";
import { useState } from "react";
import {
  WorkspaceFilters,
  emptyWorkspaceFilters,
  matchesWorkspace,
} from "./WorkspaceFilters.js";
import { Field } from "../ui/Field.js";
import { Button } from "../ui/Button.js";
export function PoReceiptSearch({ records, legacy = [], onConfirm, onLegacy }: any) {
  const [filters, setFilters] = useState({ ...emptyWorkspaceFilters }),
    [headsOnly, setHeadsOnly] = useState("all");
  const candidates = records
    .filter((r: any) => r.coordinationBucket === coordinationBuckets[5] || r.stage === "customer_tracking" || (r.route==="direct-framework"&&r.stage==="po_receipt"))
    .map((r: any) => ({
      ...r,
      site: `${r.site} (${r.siteCode})`,
      reference: [r.quotation?.number,...(r.references??[]),r.data?.directPoDetails?.values?.ipoNumber,r.data?.directPoDetails?.values?.orderNumber].filter(Boolean).join(" "),
      kind: r.quotation ? "Quotation" : r.route==="direct-framework"?`Direct PO · ${r.data?.directPoDetails?.evidenceType??"Customer PO"}`:"UBL survey / recommendation",
      customer: r.customer,
      original: r,
    })).concat(legacy.map((t:any)=>({...t,id:`legacy:${t.id}`,data:{},reference:t.number??t.reference??"",kind:"Quotation",quotation:{number:t.number??t.reference},original:t,legacy:true})));
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
                <td>{r.quotation?.number ?? r.kind}<DocumentListDetails record={r}/></td>
                <td>
                  {r.data.headsupReceived ? (
                    <span className="pz-headsup-tag">Heads-up Received</span>
                  ) : (
                    null
                  )}
                </td>
                <td>
                  <Button variant="secondary" onClick={() => r.legacy ? onLegacy(r.original) : onConfirm(r.id)}>
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
