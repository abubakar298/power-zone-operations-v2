import {recentFirst} from '../../shared/recent-records.js';
import {PagedTableBody} from '../ui/PagedTableBody.js';
import {departmentFetch} from '../department-view.js';
import {DocumentListDetails} from './DocumentListDetails.js';
import { useState } from "react";
import{downloadName,filenameFromDisposition}from'../../shared/download-name.js';
import { Button } from "../ui/Button.js";
import { DocumentPreview } from "./DocumentPreview.js";
import { IpoRevisionPanel, useIpoRevisionStatus } from "./IpoRevisionPanel.js";
import type { Session } from "../api.js";

function DownloadIpo({ record, ipoId = record.data.ipoId }: { record: any; ipoId?: string }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function download() {
    setError("");
    setLoading(true);
    try {
      const response = await departmentFetch(`/api/orders/${ipoId}/ipo.pdf`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to download IPO and PT breakup. Please try again.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get('Content-Disposition'))??downloadName({customer:record.customer,site:record.site,siteCode:record.siteCode,documentType:'IPO and PT',identity:record.id,reference:record.ipoNumber,extension:'pdf'});
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download document.");
    } finally { setLoading(false); }
  }
  return <div><Button variant="secondary" loading={loading} loadingLabel="Downloading…" onClick={() => void download()}>Download</Button>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}

export function IposSharedList({ records, onPreview }: { records: any[]; onPreview: (id: string) => void }) {
  return <section className="pz-stack" aria-label="Shared IPO documents">
    <p className="pz-caption" role="status">{records.length} IPO{records.length === 1 ? "" : "s"}</p>
    <div className="pz-table-scroll"><table className="pz-table">
      <thead><tr><th>Customer</th><th>Site / Branch code</th><th>IPO reference</th><th>PO reference / Date</th><th className="pz-ipo-actions-heading">Next actions</th></tr></thead>
      <PagedTableBody label="sites and documents">{recentFirst(records).map((record) => <tr key={record.id}>
        <td>{record.customerCode || record.customer}</td>
        <td>{record.site}<br/><span className="pz-caption">{record.siteCode || "Not entered"}</span></td>
        <td>{record.data.ipoNumber || "Not available"}<DocumentListDetails record={record}/>{record.data.historicalDelivered&&<small className="pz-caption" style={{display:"block"}}>Historical · already delivered</small>}</td>
        <td>{record.data.sharedPoReference || "Not entered"}<br/><span className="pz-caption">{record.data.sharedPoDate ? String(record.data.sharedPoDate).slice(0,10) : "Not entered"}</span></td>
        <td><div className="pz-action-row pz-ipo-list-actions"><Button variant="secondary" onClick={() => onPreview(record.id)}>Preview</Button><DownloadIpo record={record}/></div>
        </td>
      </tr>)}</PagedTableBody>
    </table></div>
    {!records.length && <p>No IPOs match these filters.</p>}
  </section>;
}

export function IpoSharedPreview({ record, onBack, session, onOpen }: { record: any; onBack: () => void; session?: Session; onOpen?: (task: any) => void }) {
  const revisions = useIpoRevisionStatus(record.id), ipoId = revisions.status?.current.id ?? record.data.ipoId, number = revisions.status?.current.number ?? record.data.ipoNumber;
  return <div className="pz-stack">
    <div><Button variant="neutral" onClick={onBack}>Back to IPOs Shared</Button></div>
    <section className="pz-panel pz-stack">
      <h2>{number || "IPO"} · {record.customerCode} · {record.site} ({record.siteCode})</h2>
      <p>PO reference: {record.data.sharedPoReference || "Not entered"} · PO date: {record.data.sharedPoDate ? String(record.data.sharedPoDate).slice(0,10) : "Not entered"}</p>
      {record.data.historicalDelivered&&<p className="pz-caption">Historical entry prepared by M. Rafiq · already delivered</p>}
      <DocumentPreview key={ipoId} url={`/api/orders/${ipoId}/ipo.pdf`} title="IPO and PT Breakup"/>
      <div className="pz-action-row"><DownloadIpo record={record} ipoId={ipoId}/></div>
    </section>
    {session&&revisions.status&&<IpoRevisionPanel session={session} recordId={record.id} status={revisions.status} onChanged={revisions.reload} onOpen={onOpen}/>}
    {/* Show why the panel cannot load instead of hiding it. */}
    {session&&!revisions.status&&revisions.error&&<section className="pz-panel pz-stack" aria-label="IPO revisions"><h3>IPO revisions</h3><p role="alert" className="form-error">IPO revision is not available for this IPO: {revisions.error}</p><div><Button variant="neutral" onClick={revisions.reload}>Try again</Button></div></section>}
  </div>;
}
