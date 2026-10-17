import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';

export function UpsAlerts(){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[customer,setCustomer]=useState<'UBL'|'MBL'|null>(null),[search,setSearch]=useState('');
 async function load(){setLoading(true);try{setData(await api('/director/ups-alerts'));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const rows=(data?.rows??[]).filter((r:any)=>r.customer===customer).filter((r:any)=>[r.siteName,r.evidenceSiteName,r.siteCode,r.orderNumber,r.ipoNumber,r.reason].join(' ').toLowerCase().includes(search.toLowerCase()));
 return <section className="pz-stack pz-ups-alerts" aria-label="Department alerts">
  {!customer?<div className="stage-grid">{(['UBL','MBL'] as const).map(bank=><button key={bank} type="button" className="stage-card" onClick={()=>{setCustomer(bank);setSearch('');}}><span>{bank} UPS Sites</span><strong>{data?(data.rows??[]).filter((r:any)=>r.customer===bank).length:'—'}</strong><small>Flagged sites · Open list →</small></button>)}</div>:<>
   <div className="pz-ups-alerts-toolbar"><h2>{customer} UPS Sites</h2><Button variant="neutral" onClick={()=>setCustomer(null)}>Back to alerts</Button></div>
   <p className="pz-caption">Flags track outstanding actions. A completed site can remain here for detail verification; installation-pending sites remain outside completed jobs.</p>
   <div className="pz-ups-alerts-toolbar"><label className="pz-field">Search flagged sites<input type="search" placeholder="Site, order, IPO or reason" value={search} onChange={e=>setSearch(e.target.value)}/></label><Button variant="neutral" loading={loading} loadingLabel="Refreshing…" onClick={()=>void load()}>Refresh</Button></div>
   <p className="pz-caption" role="status">{rows.length} flagged sites</p>
   <div className="pz-table-scroll"><table className="master-table"><thead><tr>{['S.No.','Site / order','IPO / configuration','Status / responsible department','Days since delivery','Reason','Next action','Follow-up'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={r.id}><td>{i+1}</td><td><strong>{r.siteName||'Name pending confirmation'}</strong><br/>{r.orderNumber}</td><td>{r.ipoNumber}<br/>{r.configuration==='6-10'?'6 kW + 10 kWh':'6 kW + 5 kWh'}</td><td><StatusBadge tone="warning">{r.status}</StatusBadge><br/>{r.responsibleDepartment||'Operations'}</td><td>{r.daysSinceDelivery===null||r.daysSinceDelivery===undefined?'Not confirmed':`${r.daysSinceDelivery} days`}{r.deliveryDate&&<p className="pz-caption" title={r.deliveryDateSource}>{r.deliveryDate}</p>}</td><td>{r.reason}</td><td>{r.nextAction}</td><td>{r.followUpDate||'Not scheduled'}</td></tr>)}{data&&!rows.length&&<tr><td colSpan={8}>{search?'No flagged sites match this search.':`No ${customer} UPS alerts.`}</td></tr>}</tbody></table></div>
  </>}
  {loading&&!data&&<p role="status">Loading alerts…</p>}{error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
