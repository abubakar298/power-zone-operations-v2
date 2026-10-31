import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {MaterialUsage} from '../components/MaterialUsage.js';
import {WarehouseMovements} from '../components/WarehouseMovements.js';
import {decimalDisplay} from '../numbers.js';
import {navigateInventory} from '../inventory-approved/navigation.js';
const shown=(v:unknown)=>v===null||v===undefined?'Pending':decimalDisplay(String(v),0);
/** Direct ledger entry for the exact issued preparation, never a site-plan ID guess. */
export function DispatchReconciliationPage({session,id}:{session:Session;id:string}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;void api<any>('/material-dispatches/drafts/'+encodeURIComponent(id)+'/site-usage').then(v=>{if(active){setData(v);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id,revision]);
 const plan=data?.draft.snapshot.combinedPlan;
 return <section className="pz-panel pz-stack"><div className="ob-page-title"><h1>Site material reconciliation</h1><div className="ob-actions"><Button variant="neutral" onClick={()=>navigateInventory('/inventory')}>Back to Inventory</Button><Button variant="neutral" onClick={()=>setRevision(v=>v+1)}>Refresh ledger</Button></div></div>{error&&<p role="alert" className="form-error">{error}</p>}{!data&&!error&&<p role="status">Loading the dispatched material ledger…</p>}{data&&<><h2>{data.references.join(' · ')||'Material dispatch'}</h2><div>{data.draft.snapshot.sites.map((s:any)=><div key={s.siteId}><strong>{s.siteName}</strong><small style={{display:'block'}}>{s.customer} · {[s.ipo,s.orderNumber].filter(Boolean).join(' · ')}</small></div>)}</div><p>Review site usage and verified returns. Customer documents do not automatically close the ledger or credit stock.</p>{plan&&<div className="pz-action-row"><MaterialUsage id={plan.id} kind="site" version={plan.version} session={session}/><WarehouseMovements id={plan.id} kind="site" version={plan.version} session={session}/></div>}<div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>SR#</th><th>Item / material</th><th>UOM</th><th>Dispatched</th><th>Used</th><th>Expected return</th><th>Verified return</th><th>Balance</th><th>Status</th></tr></thead><tbody>{(data.reconciliation?.rows??[]).map((r:any,i:number)=><tr key={r.key}><td>{i+1}</td><td><strong>{r.itemId}</strong><small style={{display:'block'}}>{r.description}</small></td><td>{r.unit}</td><td>{shown(r.warehouseOut)}</td><td>{shown(r.used)}</td><td>{shown(r.expectedReturn)}</td><td>{shown(r.verifiedWarehouseReturn)}</td><td>{shown(r.remaining)}</td><td>{r.status}</td></tr>)}</tbody></table></div>{!data.reconciliation&&<p>No confirmed material dispatch is available for this preparation.</p>}</>}</section>;
}
