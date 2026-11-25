import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {PagedTableBody} from '../ui/PagedTableBody.js';
import {slotRanges} from '../../shared/order-slot-ranges.js';
import {ProjectWorkspace} from '../pages/ProjectWorkspace.js';

export type SlotProgramme={key:string;customer:string;ipo:string;capacity:number;extra:number;inUse:number;freeCount:number;free:number[]};
export type CancelledSiteRow={id:string;sr:number;source:'Operations'|'Reviewed register';outcome:'Cancelled'|'Transferred';customer:string;ipo:string;order:string;site:string;siteCode:string;po:string;
 recordId:string|null;projectKey:string|null;cancelledAt:string|null;cancelledBy:string|null;reason:string;slot:'Free'|'In use again';reusedBy:{site:string;siteCode:string}|null};
export type CancelledSites={programmes:SlotProgramme[];sites:CancelledSiteRow[]};

const day=(value:string|null)=>value?String(value).slice(0,10):'Date not recorded';

/** Free order slots per bank programme: a cancelled site's slot is free for the next new or renewed order. */
export function FreeSlotsPanel({programmes}:{programmes:SlotProgramme[]}){
 if(!programmes.length)return null;
 return <section className="pz-panel pz-stack" aria-label="Free order slots">
  <h3>Free order slots</h3>
  <p className="pz-caption">When the Operations head cancels a site, its slot (for example 154/250) becomes free here at once. Use a free slot number for the next new or renewed order of the same IPO. UBL UPS 250 can take extra orders above 250 (251/250, 252/250 …) once no slot is free.</p>
  <div className="pz-table-scroll"><table className="pz-table">
   <thead><tr><th scope="col">Programme</th><th scope="col">Slots</th><th scope="col">In use</th><th scope="col">Free</th><th scope="col">Free slot numbers</th></tr></thead>
   <tbody>{programmes.map(p=><tr key={p.key}>
    <td>{p.ipo}<div className="pz-caption">{p.customer}</div></td>
    <td>{p.capacity}{p.extra>0&&<div className="pz-caption">+{p.extra} extra order{p.extra===1?'':'s'} ({p.capacity}+)</div>}</td>
    <td>{p.inUse}</td>
    <td><strong>{p.freeCount}</strong></td>
    <td>{p.freeCount?slotRanges(p.free):'No free slot'}</td>
   </tr>)}</tbody>
  </table></div>
 </section>;
}

export function CancelledSitesTable({sites,onOpenRecord,onOpenProject}:{sites:CancelledSiteRow[];onOpenRecord:(id:string)=>void;onOpenProject:(key:string)=>void}){
 return <section className="pz-stack" aria-label="Cancelled sites">
  <p className="pz-caption" role="status">{sites.length} cancelled site{sites.length===1?'':'s'} · kept with all their documents and history</p>
  <div className="pz-table-scroll"><table className="pz-table">
   <thead><tr><th scope="col">SR#</th><th scope="col">Customer</th><th scope="col">Site / Branch code</th><th scope="col">Cancelled from</th><th scope="col">Cancelled on</th><th scope="col">Slot now</th><th scope="col" className="pz-ipo-actions-heading">Documents</th></tr></thead>
   <PagedTableBody label="cancelled sites">{sites.map(s=><tr key={s.id}>
    <td>{s.sr}</td>
    <td>{s.customer}</td>
    <td>{s.site||'Site name not recorded'}<div className="pz-caption">{s.siteCode||'Not entered'}</div></td>
    <td>Cancelled from {s.order}<div className="pz-caption">IPO {s.ipo}{s.po?` · PO ${s.po}`:''}</div></td>
    <td>{day(s.cancelledAt)}<div className="pz-caption">{s.outcome==='Transferred'?'Transferred':'Cancelled'}{s.source==='Operations'?` by ${s.cancelledBy??'Operations'}`:' (reviewed register)'}{s.reason?` · ${s.reason}`:''}</div></td>
    <td>{s.slot==='Free'?<StatusBadge tone="success">Free</StatusBadge>:<StatusBadge tone="pending">In use again</StatusBadge>}{s.reusedBy&&<div className="pz-caption">Now used by {s.reusedBy.site}{s.reusedBy.siteCode?` (${s.reusedBy.siteCode})`:''}</div>}</td>
    <td><div className="pz-action-row pz-ipo-list-actions">
     {s.recordId&&<Button variant="secondary" onClick={()=>onOpenRecord(s.recordId!)}>Open IPO</Button>}
     {s.projectKey&&<Button variant="secondary" onClick={()=>onOpenProject(s.projectKey!)}>Project file</Button>}
     {!s.recordId&&!s.projectKey&&<span className="pz-caption">Historical register order; no portal documents</span>}
    </div></td>
   </tr>)}</PagedTableBody>
  </table></div>
  {!sites.length&&<p>No cancelled sites.</p>}
 </section>;
}

/** Coordination → Cancelled Sites. Read only: cancelled sites are never edited or deleted. */
export function CancelledSitesList({session,onOpenRecord,onOpen}:{session:Session;onOpenRecord:(id:string)=>void;onOpen:(task:any)=>void}){
 const [data,setData]=useState<CancelledSites>(),[error,setError]=useState(''),[projectKey,setProjectKey]=useState<string>();
 useEffect(()=>{let alive=true;api<CancelledSites>('/project-workflow/cancelled-sites').then(r=>{if(alive)setData(r);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to load cancelled sites.');});return()=>{alive=false;};},[]);
 if(projectKey)return <ProjectWorkspace projectKey={projectKey} onBack={()=>setProjectKey(undefined)} onOpen={onOpen} session={session}/>;
 if(error)return <p className="form-error" role="alert">{error}</p>;
 if(!data)return <p role="status">Loading cancelled sites…</p>;
 return <div className="pz-stack">
  <FreeSlotsPanel programmes={data.programmes}/>
  <CancelledSitesTable sites={data.sites} onOpenRecord={onOpenRecord} onOpenProject={setProjectKey}/>
 </div>;
}
