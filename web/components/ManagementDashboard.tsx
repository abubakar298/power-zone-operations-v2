import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {ManagementApprovals} from './ManagementApprovals.js';
import {isInstalledUpsSite,upsDashboardSummary,type UpsDashboardData} from '../workspaces/management-dashboard.js';

export function ManagementDashboard({session,onOpen,onOpenUps}:{session:Session;onOpen:(task:any)=>void;onOpenUps:()=>void}){
 const [data,setData]=useState<UpsDashboardData>(),[error,setError]=useState('');
 const [expanded,setExpanded]=useState(false),[filter,setFilter]=useState('all'),[search,setSearch]=useState('');
 useEffect(()=>{
  let active=true,generation=0;
  const load=async()=>{const request=++generation;try{
   const result=await api<UpsDashboardData>('/director/ups?customer=UBL');
   if(active&&request===generation){setData(result);setError('');}
  }catch(e){if(active&&request===generation)setError((e as Error).message);}};
  const reset=()=>{setExpanded(false);setFilter('all');setSearch('');void load();};
  void load();window.addEventListener('focus',load);window.addEventListener('pz:workspace-open',reset);
  const timer=setInterval(load,30000);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('pz:workspace-open',reset);};
 },[session.user.id]);
 const totals=data?upsDashboardSummary(data):undefined;
 const rows=(data?.register.rows??[]).filter(r=>(filter==='all'||(filter==='installed'?isInstalledUpsSite(r):!isInstalledUpsSite(r)))&&[r.site,r.siteCode,r.number,r.projectReference,r.orderNumber].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
 return <ManagementApprovals session={session} onOpen={onOpen} additionalBuckets={
  <button type="button" className={`stage-card${expanded?' selected':''}`} aria-expanded={expanded} aria-controls="management-ubl-ups" onClick={()=>setExpanded(!expanded)}>
   <span>UBL UPS</span><strong>{totals?totals.received:'—'}</strong>
   <small>{totals?`IPOs received · ${totals.installed} ${totals.installed===1?'site':'sites'} installed`:'Loading IPO and installation totals…'}</small>
   {totals&&<small>{totals.completionUnconfirmed} sites awaiting installation confirmation</small>}
  </button>
 }>
  {error&&<p className="form-error" role="alert">UBL UPS summary could not refresh: {error}{data?' Displayed counts are from the last successful refresh.':''}</p>}
  {expanded&&<section id="management-ubl-ups" className="pz-stack" aria-label="UBL UPS IPOs and installations">
   <h2>UBL UPS · IPOs received and installed sites</h2>
   <p className="pz-caption">Saved site IPOs, including the historical register, count once as in the UBL UPS workspace. Installed means completion is recorded; delivery or an invoice alone does not count as installation.</p>
   <div className="pz-action-row">
    {([['all','All IPOs',totals?.received],['installed','Installed',totals?.installed],['unconfirmed','Installation unconfirmed',totals?.completionUnconfirmed]] as const).map(([value,label,count])=><Button key={value} variant={filter===value?'secondary':'neutral'} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}{count===undefined?'':` (${count})`}</Button>)}
    <Button variant="secondary" onClick={onOpenUps}>Open UBL UPS workspace</Button>
   </div>
   <label className="pz-field">Search UBL UPS sites<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Site, branch code, IPO or order number"/></label>
   {!data&&!error&&<p role="status">Loading UBL UPS sites…</p>}
   {data&&<><p className="pz-caption" role="status">{rows.length} {rows.length===1?'site':'sites'} shown</p><div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Site / branch</th><th>IPO / order number</th><th>Installation</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.id}><td><strong>{r.site||'Site not entered'}</strong>{r.siteCode&&<><br/>{r.siteCode}</>}</td><td>{r.number||r.projectReference||'Not entered'}{r.orderNumber&&<><br/>{r.orderNumber}</>}</td><td>{isInstalledUpsSite(r)?'Installed':'Completion not confirmed'}<p className="pz-caption">{r.status}</p></td></tr>)}
    {!rows.length&&<tr><td colSpan={3}>No UBL UPS sites match this selection.</td></tr>}
   </tbody></table></div></>}
  </section>}
 </ManagementApprovals>;
}
