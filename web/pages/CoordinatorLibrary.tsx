import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
type RecordLink={id:string;number:string;customer:string;site:string;type:string;task:any};
/** Read-only navigation index. Existing endpoints remain the authority for ownership. */
export function CoordinatorLibrary({mode,onOpen,active}:{mode:'projects'|'documents';active:boolean;onOpen:(task:any)=>void}) {
 const [records,setRecords]=useState<RecordLink[]>([]),[tasks,setTasks]=useState<any[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[masters,setMasters]=useState<any>({customers:[],sites:[]});
 const [query,setQuery]=useState(''),[customer,setCustomer]=useState(''),[site,setSite]=useState(''),[type,setType]=useState('');
 useEffect(()=>{if(!active)return;let alive=true;async function load(){try{
 const [b,q,o,c,w,m,d]=await Promise.all([api<any>('/boqs'),api<any>('/commercial/quotations'),api<any>('/orders'),api<any>('/cni'),api<any>('/coordinator?scope=mine'),api<any>('/masters'),api<any>('/boqs/drafts')]);
 const quotes=q.quotations??[];
 const links:RecordLink[]=[...(d.drafts??[]).map((r:any)=>({id:r.id,number:r.inputs?.siteName??'Survey draft',customer:m.customers.find((x:any)=>String(x.id)===String(r.inputs?.customerId))?.name??'',site:r.inputs?.siteName??'',type:'Survey draft',task:{target:'boqs',draft_id:r.id}})),...(b.boqs??b.records??[]).map((r:any)=>({...r,type:'BOQ',task:{target:'boqs',kind:'Saved BOQ',id:r.id}})),...quotes.map((r:any)=>({...r,type:'Quotation',task:{target:'quotes',kind:'Sale confirmation',id:r.id}})),...(o.orders??[]).map((r:any)=>({...r,site:quotes.find((x:any)=>x.number===r.quotation_number)?.site??'',type:'IPO',task:{target:'orders',kind:'Operations issuance',ipo_id:r.id}})),...(c.proposals??[]).map((r:any)=>({id:r.id,number:r.number,customer:r.snapshot?.customer?.name??'',site:r.snapshot?.siteName??'',type:'C&I proposal',task:{target:'quotes',kind:'C&I proposal',id:r.id}}))];
 if(alive){setMasters(m);setRecords(links);setTasks(w.tasks??[]);setError('');}
 }catch(e){if(alive)setError((e as Error).message);}finally{if(alive)setLoading(false);}}void load();return()=>{alive=false};},[active]);
 const customers:string[]=[...new Set<string>([...records.map(r=>r.customer),...masters.customers.map((r:any)=>r.name)].filter(Boolean))].sort();
 const sites:string[]=[...new Set<string>([...records.filter(r=>!customer||r.customer===customer).map(r=>r.site),...masters.sites.filter((r:any)=>!customer||r.customer_name===customer).map((r:any)=>r.name)].filter(Boolean))].sort();
 const visible=records.filter(r=>(!customer||r.customer===customer)&&(!site||r.site===site)&&(!type||r.type===type)&&`${r.number} ${r.customer} ${r.site}`.toLowerCase().includes(query.toLowerCase()));
 return <section className="pz-panel pz-stack" aria-busy={loading}>
 <h2>{mode==='projects'?'Customer & site work':'Document library'}</h2>
 <p>{mode==='projects'?'Select a customer and site to find their work and continue the project.':'Find saved documents by reference, customer, site or document type.'}</p>
 <div className="pz-form-grid">
 <Field id="library-search" label="Search references, customers or sites"><input id="library-search" value={query} onChange={e=>setQuery(e.target.value)}/></Field>
 <Field id="library-customer" label="Customer filter"><select id="library-customer" value={customer} onChange={e=>{setCustomer(e.target.value);setSite('')}}><option value="">All customers</option>{customers.map(c=><option key={c}>{c}</option>)}</select></Field>
 <Field id="library-site" label="Site filter"><select id="library-site" value={site} onChange={e=>setSite(e.target.value)}><option value="">All sites</option>{sites.map(s=><option key={s}>{s}</option>)}</select></Field>
 <Field id="library-type" label="Document type"><select id="library-type" value={type} onChange={e=>setType(e.target.value)}><option value="">All document types</option>{['Survey draft','BOQ','Quotation','C&I proposal','IPO'].map(t=><option key={t}>{t}</option>)}</select></Field>
 </div>
 <div className="pz-action-row"><Button variant="neutral" onClick={()=>{setQuery('');setCustomer('');setSite('');setType('')}}>Clear filters</Button></div>
 {mode==='projects'&&<><h3>Project actions</h3><div className="pz-action-row">{[['boqs','Surveys & BOQs'],['quotes','Quotations'],['orders','IPOs'],['operations','BOQs to Operations']].map(([target,label])=><Button key={target} variant="secondary" onClick={()=>onOpen({target})}>{label}</Button>)}</div><p>Open the selected saved document below for its exact project context.</p></>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 {loading?<p role="status">Loading your documents…</p>:<><p>{visible.length} documents · Latest 200 per document list; latest C&amp;I versions.</p>
 <div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>Reference</th><th>Type</th><th>Customer / Site</th><th>Pending action</th><th>Action</th></tr></thead><tbody>{visible.map(r=>{const pending=tasks.find(t=>t.id===r.id||t.boq_revision_id===r.id||t.ipo_id===r.id);return <tr key={r.type+r.id}><td>{r.number}</td><td>{r.type}</td><td>{r.customer}<br/>{r.site||'Site not recorded'}</td><td>{pending?.stage??'No pending task in your workspace'}</td><td><Button variant="secondary" onClick={()=>onOpen(pending??r.task)}>Open workflow</Button></td></tr>})}</tbody></table></div>{!visible.length&&<p>No documents match these filters. Clear filters or create a New BOQ.</p>}</>}
 </section>;
}
