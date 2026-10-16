import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';

export function UpsAlerts(){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[open,setOpen]=useState(false),[search,setSearch]=useState('');
 async function load(){setLoading(true);try{setData(await api('/director/ups-alerts'));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const rows=(data?.rows??[]).filter((r:any)=>[r.siteName,r.evidenceSiteName,r.siteCode,r.orderNumber,r.ipoNumber,r.reason].join(' ').toLowerCase().includes(search.toLowerCase()));
 return <section className="pz-stack pz-ups-alerts" aria-label="Department alerts">
  {!open?<div className="stage-grid"><button type="button" className="stage-card" onClick={()=>setOpen(true)}><span>UBL UPS Sites</span><strong>{data?.total??'—'}</strong><small>Flagged sites · Open list →</small></button></div>:<>
   <div className="pz-ups-alerts-toolbar"><h2>UBL UPS Sites</h2><Button variant="neutral" onClick={()=>setOpen(false)}>Back to alerts</Button></div>
   <p className="pz-caption">Flagged sites remain active and budgeted. Installation and Accounts review alerts are excluded from approved closed jobs.</p>
   <div className="pz-ups-alerts-toolbar"><label className="pz-field">Search flagged sites<input type="search" placeholder="Site, order, IPO or reason" value={search} onChange={e=>setSearch(e.target.value)}/></label><Button variant="neutral" loading={loading} loadingLabel="Refreshing…" onClick={()=>void load()}>Refresh</Button></div>
   <p className="pz-caption" role="status">{rows.length} flagged sites</p>
   <div className="pz-table-scroll"><table className="master-table"><thead><tr>{['S.No.','Site / order','IPO / configuration','Status / responsible department','Days since delivery','Reason','Next action','Follow-up'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={r.id}><td>{i+1}</td><td><strong>{r.siteName||'Name pending confirmation'}</strong><br/>{r.orderNumber}</td><td>{r.ipoNumber}<br/>{r.configuration==='6-10'?'6 kW + 10 kWh':'6 kW + 5 kWh'}</td><td><StatusBadge tone="warning">{r.status}</StatusBadge><br/>{r.responsibleDepartment||'Operations'}</td><td>{r.daysSinceDelivery===null||r.daysSinceDelivery===undefined?'Not confirmed':`${r.daysSinceDelivery} days`}{r.deliveryDate&&<p className="pz-caption" title={r.deliveryDateSource}>{r.deliveryDate}</p>}</td><td>{r.reason}</td><td>{r.nextAction}</td><td>{r.followUpDate||'Not scheduled'}</td></tr>)}{data&&!rows.length&&<tr><td colSpan={8}>{search?'No flagged sites match this search.':'No UBL UPS installation alerts.'}</td></tr>}</tbody></table></div>
  </>}
  {loading&&!data&&<p role="status">Loading alerts…</p>}{error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
