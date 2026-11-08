import {recentFirst} from '../../shared/recent-records.js';
import {PagedTableBody} from '../ui/PagedTableBody.js';
import {Decimal} from 'decimal.js';
import {DocumentListDetails} from './DocumentListDetails.js';
import { Button } from "../ui/Button.js";

type FollowupActions = {
  onOpen: (record: any) => void;
  onRevise: (record: any) => void;
  onConfirmSale: (record: any) => void;
};

function SitesTable({
  records,
  onOpen,
  onRevise,
  onConfirmSale,
}: { records: any[] } & FollowupActions) {
  return (
    <div className="pz-table-scroll">
      <table className="pz-table pz-followup-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Site / Branch code</th>
            <th>Document</th>
            <th>Action</th>
          </tr>
        </thead>
        <PagedTableBody label="records">
          {recentFirst(records).map((record) => {
            const cni = record.legacyTask?.kind === "C&I proposal";
            const canRevise = cni || record.quotation?.id || record.sourceQuotationId || record.route === "survey-framework";
            const canConfirm = record.legacyTask
              ? record.legacyTask.kind === "Sale confirmation" && Boolean(record.legacyTask.boq_revision_id)
              : record.route === "survey-framework" || Boolean(record.quotation?.id);
            return (
              <tr key={record.id}>
                <td>{record.customer}<span className="pz-followup-secondary">{record.customerCode}</span></td>
                <td>{record.site}<span className="pz-followup-secondary">{record.siteCode || "Branch code not entered"}</span></td>
                <td>
                  {record.route === "survey-framework" ? "Pre-agreed Survey" : record.quotation?.number || record.legacyTask?.number || "Quotation"}
                  <span className="pz-followup-secondary">{record.routeLabel}</span>
                  <DocumentListDetails record={record}/>
                  {record.data.headsupReceived && <span className="pz-headsup-tag">Heads-up Received</span>}
                </td>
                <td>
                  <div className="pz-action-row pz-quotation-revision-actions">
                    <Button variant="secondary" onClick={() => onOpen(record)}>Review</Button>
                    <Button variant="secondary" disabled={!canRevise} onClick={() => onRevise(record)}>Revise</Button>
                    <Button variant="secondary" disabled={!canConfirm} onClick={() => onConfirmSale(record)}>Confirm Sale</Button>
                  </div>
                  {!canConfirm && (
                    <span className="pz-followup-secondary">
                      {cni ? "C&I sale confirmation is unavailable here." : "No approved quotation or configuration is linked."}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </PagedTableBody>
      </table>
    </div>
  );
}

export function CustomerFollowupList({
  records,
  groups,
  ...actions
}: { records: any[]; groups: any[] } & FollowupActions) {
  const count =
    records.length +
    groups.reduce((total, group) => total + group.sites.length, 0);
  return (
    <div className="pz-stack pz-followup-list">
      <p className="pz-caption">
        {count} project{count === 1 ? "" : "s"} awaiting customer follow-up
      </p>
      <section className="pz-panel pz-stack">
        <div className="pz-followup-heading">
          <h3>Individual Sites</h3>
          <span className="pz-caption">
            {records.length} site{records.length === 1 ? "" : "s"}
          </span>
        </div>
        {records.length ? (
          <SitesTable records={records} {...actions} />
        ) : (
          <p className="pz-caption">No individual sites match these filters.</p>
        )}
      </section>
      <section className="pz-panel pz-stack">
        <div className="pz-followup-heading">
          <h3>Combined Surveys</h3>
          <span className="pz-caption">
            {groups.length} submission{groups.length === 1 ? "" : "s"}
          </span>
        </div>
        {groups.map((group) => (
          <details className="pz-form-section pz-followup-group" key={group.id}>
            <summary>
              <span>
                {group.customer}
                <span className="pz-followup-secondary">
                  {group.sites[0]?.surveyBatchNumber || "Batch reference not available"}
                </span>
              </span>
              <DocumentListDetails record={{solutionType:'Solar Hybrid',documentAmount:group.sites.every((site:any)=>site.documentAmount!=null)?group.sites.reduce((sum:Decimal,site:any)=>sum.add(site.documentAmount),new Decimal(0)).toFixed(2):null}}/>
              <span className="pz-headsup-tag">
                {group.sites.length} site{group.sites.length === 1 ? "" : "s"}
              </span>
            </summary>
            <SitesTable records={group.sites} {...actions} />
          </details>
        ))}
        {!groups.length && (
          <p className="pz-caption">No combined surveys match these filters.</p>
        )}
      </section>
    </div>
  );
}

