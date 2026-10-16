import {useEffect,useMemo,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {decimalDisplay} from '../numbers.js';

/** Submitted documents only; pending surveys must never appear as verified. */
export function submittedUblReviews(records:any[]) {
 return records.filter(r=>r.customerCode?.toUpperCase()==='UBL'&&r.route==='survey-framework'&&r.data?.designHandoffAt&&r.data?.reviewDocumentId)
  .sort((a,b)=>Number(!!b.data.ublStandardsReview?.needsReview)-Number(!!a.data.ublStandardsReview?.needsReview)||String(a.siteCode).localeCompare(String(b.siteCode),undefined,{numeric:true})||a.id.localeCompare(b.id));
}
export function UblTechnicalReviewSummary({session,records,onBack,onOpen}:{session:Session;records:any[];onBack:()=>void;onOpen:(id:string)=>void}) {
 const submitted=useMemo(()=>submittedUblReviews(records),[records]);
 const [search,setSearch]=useState(''),[results,setResults]=useState<Record<string,any>>({}),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true,cursor=0;setResults({});
  // Bound read-only document requests; do not issue one simultaneous request per site.
  const worker=async()=>{while(active&&cursor<submitted.length){const record=submitted[cursor++];try{
   const summary=await api<any>(`/project-workflow/${record.id}/preview`,{csrf:session.csrfToken,body:{kind:'technical-summary'}});
   if(active)setResults(old=>({...old,[record.id]:summary.reviewNumber?summary:{error:'The submitted technical review document is unavailable.'}}));
  }catch(error){if(active)setResults(old=>({...old,[record.id]:{error:error instanceof Error?error.message:'Unable to load this saved review.'}}));}}};
  void Promise.all(Array.from({length:Math.min(3,submitted.length)},worker));return()=>{active=false;};
 },[submitted,session.user.id,session.csrfToken,attempt]);
 const rows=submitted.map((record,index)=>({record,sr:index+1,summary:results[record.id]})).filter(({record,summary})=>[record.siteCode,record.site,summary?.reviewNumber,summary?.survey?.bessId,summary?.remarks].join(' ').toLowerCase().includes(search.toLowerCase()));
 return <section className="pz-stack" aria-label="UBL Technical Review Summary">
  <div className="pz-action-row"><Button variant="neutral" onClick={onBack}>Back to surveys</Button><Button variant="secondary" onClick={()=>setAttempt(a=>a+1)} disabled={!submitted.length}>Refresh summary</Button></div>
  <h2>UBL Technical Review Summary</h2>
  <p>Submitted reviews remain in Design’s Sent to Coordination history and continue in Atif’s Design Review bucket. This page reads the saved technical review; it does not approve or send anything.</p>
  <Field id="ubl-technical-summary-search" label="Search branch code, site, BESS ID, review reference or remarks"><input id="ubl-technical-summary-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
  <p role="status">Showing {rows.length} of {submitted.length} submitted UBL sites. {records.filter(r=>r.customerCode?.toUpperCase()==='UBL'&&r.route==='survey-framework'&&!r.data?.designHandoffAt).length} UBL surveys have not yet been handed off.</p>
  {!submitted.length?<p>No submitted UBL technical reviews yet. Submit a completed Technical Review to include it here.</p>:<div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>Sr. No.</th><th>Branch code / site</th><th>Saved review</th><th>Recommended BESS</th><th>Panels</th><th>Cable differences</th><th>Technical remarks</th><th>Next action</th></tr></thead><tbody>{rows.map(({record:r,sr,summary:s})=><tr key={r.id}>
   <td>{sr}</td><td><strong>{r.siteCode}</strong><br/>{r.site}</td>
   {!s?<td colSpan={5} role="status">Loading saved technical review…</td>:s.error?<td colSpan={5} role="alert">{s.error}</td>:<>
    <td>{s.reviewNumber}<br/>{s.reviewedAt?new Date(s.reviewedAt).toLocaleDateString('en-GB',{timeZone:'Asia/Karachi'}):'Date not recorded'}<br/>{s.status}</td>
    <td>{s.survey?.bessId??'Not entered'}<br/>{s.survey?.inverter??'Not entered'} · {decimalDisplay(s.survey?.batteryKwh,0)} kWh</td>
    <td>{decimalDisplay(s.survey?.panelQty,0)} × {decimalDisplay(s.survey?.panelWattage,0)} W<br/>{decimalDisplay(s.survey?.totalWattage,0)} W{(s.panels??[]).map((p:any)=><p className="pz-caption" key={p.field}>Agreed {decimalDisplay(p.approved,0)} W → entered {decimalDisplay(p.entered,0)} W</p>)}</td>
    <td>{(s.cableRows??[]).filter((c:any)=>c.different).length?<details><summary>{s.cableRows.filter((c:any)=>c.different).length} cable differences</summary>{s.cableRows.filter((c:any)=>c.different).map((c:any)=><p className="pz-caption" key={c.field}>{c.field}: {decimalDisplay(c.approved)} → {decimalDisplay(c.entered)} m</p>)}</details>:'No cable differences'}</td>
    <td>{r.data.ublStandardsReview?.needsReview&&<strong>Flagged for UBL discussion<br/></strong>}{s.remarks||'No remarks recorded'}</td>
   </>}
   <td><Button variant="secondary" onClick={()=>onOpen(r.id)}>Open review</Button></td>
  </tr>)}</tbody></table>{!rows.length&&<p>No submitted reviews match this search.</p>}</div>}
 </section>;
}
