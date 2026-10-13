import { Button } from "../ui/Button.js";

function HeadsupStatus({ record }: { record: any }) {
  const data = record.data;
  if (!data.headsupReceived)
    return <span className="pz-caption">Awaiting customer response</span>;
  return (
    <div className="pz-followup-status">
      <span className="pz-headsup-tag">Heads-up Received</span>
      {data.headsupSolution && (
        <span className="pz-caption">{data.headsupSolution}</span>
      )}
      {data.headsupDate && (
        <span className="pz-caption">
          {new Date(data.headsupDate).toLocaleDateString("en-PK", {
            timeZone: "Asia/Karachi",
          })}
        </span>
      )}
      {data.advanceBoqSent && (
        <span className="pz-caption">Advance BOQ Sent</span>
      )}
    </div>
  );
}

function SitesTable({
  records,
  onOpen,
}: {
  records: any[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="pz-table-scroll">
      <table className="pz-table pz-followup-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Site / Branch code</th>
            <th>Document</th>
            <th>Customer response</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                {record.customer}
                <span className="pz-followup-secondary">
                  {record.customerCode}
                </span>
              </td>
              <td>
                {record.site}
                <span className="pz-followup-secondary">
                  {record.siteCode || "Branch code not entered"}
                </span>
              </td>
              <td>
                {record.route === "survey-framework"
                  ? "Pre-agreed Survey"
                  : "Quotation"}
                <span className="pz-followup-secondary">
                  {record.routeLabel}
                </span>
              </td>
              <td>
                <HeadsupStatus record={record} />
              </td>
              <td>
                <Button variant="secondary" onClick={() => onOpen(record.id)}>
                  Review
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CustomerFollowupList({
  records,
  groups,
  onOpen,
}: {
  records: any[];
  groups: any[];
  onOpen: (id: string) => void;
}) {
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
          <SitesTable records={records} onOpen={onOpen} />
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
                  Survey {group.id.slice(0, 8)} · Branch codes:{" "}
                  {group.sites
                    .map((site: any) => site.siteCode || "Not entered")
                    .join(", ")}
                </span>
              </span>
              <span className="pz-headsup-tag">
                {group.sites.length} site{group.sites.length === 1 ? "" : "s"}
              </span>
            </summary>
            <SitesTable records={group.sites} onOpen={onOpen} />
          </details>
        ))}
        {!groups.length && (
          <p className="pz-caption">No combined surveys match these filters.</p>
        )}
      </section>
    </div>
  );
}
