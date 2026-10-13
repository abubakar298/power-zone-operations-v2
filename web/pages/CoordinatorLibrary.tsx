import {displayDate} from '../../server/display/dates.js';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {LibraryDocumentPreview,type PreviewDocument} from '../components/LibraryDocumentPreview.js';
import {ProjectWorkspace,familyLabel} from './ProjectWorkspace.js';
import {Field} from '../ui/Field.js';
type RecordLink=PreviewDocument & {task:any;project_key?:string;site_code?:string;proposal_id?:string;created_at?:string;version?:number;version_status?:string;status_explanation?:string};
/** Read-only navigation index. Existing endpoints remain the authority for ownership. */
export function CoordinatorLibrary({mode,onOpen,active,initialProjectKey,initialDocumentId}:{initialDocumentId?:string;initialProjectKey?:string;mode:'projects'|'documents';active:boolean;onOpen:(task:any)=>void}) {
 const [records,setRecords]=useState<RecordLink[]>([]),[tasks,setTasks]=useState<any[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[masters,setMasters]=useState<any>({customers:[],sites:[]});
 const [projectKey,setProjectKey]=useState<string>(),[catalog,setCatalog]=useState<any[]>([]);
 useEffect(()=>{if(initialProjectKey)setProjectKey(initialProjectKey)},[initialProjectKey]);
 const [handledDocumentId,setHandledDocumentId]=useState<string>();
 const [preview,setPreview]=useState<{record:RecordLink;stage:string}>();
 useEffect(()=>{if(!active)setPreview(undefined)},[active]);
 useEffect(()=>{if(mode==='documents')setProjectKey(undefined)},[mode]);
 const [query,setQuery]=useState(''),[customer,setCustomer]=useState(''),[site,setSite]=useState(''),[type,setType]=useState('');
 useEffect(()=>{if(!active)return;let alive=true;async function load(){try{
 const [w,m,d,p]=await Promise.all([api<any>('/coordinator?scope=mine'),api<any>('/masters'),api<any>('/boqs/drafts'),api<any>('/coordinator/projects')]);
 const links:RecordLink[]=(p.documents??[]).map((r:any)=>({...r,pdfUrl:r.pdf_url,inputs:r.resource==='draft'?d.drafts?.find((x:any)=>x.id===r.id)?.inputs:undefined}));
 if(alive){setCatalog(p.documents??[]);setMasters(m);setRecords(links);setTasks(w.tasks??[]);setError('');}
 }catch(e){if(alive)setError((e as Error).message);}finally{if(alive)setLoading(false);}}void load();return()=>{alive=false};},[active]);
 useEffect(()=>{if(!initialDocumentId||loading||handledDocumentId===initialDocumentId)return;setHandledDocumentId(initialDocumentId);const record=records.find(r=>r.id===initialDocumentId);if(record)setPreview({record,stage:record.stage??"Saved"});else setError('This saved document is unavailable to your account.');},[initialDocumentId,records,loading,handledDocumentId]);
 const customers:string[]=[...new Set<string>([...records.map(r=>r.customer),...masters.customers.map((r:any)=>r.name)].filter(Boolean))].sort();
 const sites:string[]=[...new Set<string>([...records.filter(r=>!customer||r.customer===customer).map(r=>r.site),...masters.sites.filter((r:any)=>!customer||r.customer_name===customer).map((r:any)=>r.name)].filter(Boolean))].sort();
 const matches=(r:any)=>(!customer||r.customer===customer)&&(!site||r.site===site)&&(!type||r.type===type)&&`${r.number} ${r.customer} ${r.site} ${r.site_code??''}`.toLowerCase().includes(query.trim().toLowerCase());
 const projectGroups=[...new Map([...catalog].filter(matches).reverse().map(d=>[d.project_key,d])).values()];
 const visible=records.filter(matches);
 if(projectKey)return <ProjectWorkspace projectKey={projectKey} onBack={()=>setProjectKey(undefined)} onOpen={onOpen}/>;
 if(preview)return <LibraryDocumentPreview document={preview.record} stage={preview.stage} onBack={()=>setPreview(undefined)}/>;
 return <section className="pz-panel pz-stack" aria-busy={loading}>
 <h2>{mode==='projects'?'Customer & site work':'Document library'}</h2>
 <p>{mode==='projects'?'Select a customer and site to find their work and continue the project.':'Search all permitted saved versions by document reference, customer, site name/code or type.'}</p>
 <div className="pz-form-grid">
 <Field id="library-search" label="Search references, customers or sites"><input id="library-search" type="search" placeholder="Customer, site/code, BOQ, quotation or IPO reference" value={query} onChange={e=>setQuery(e.target.value)}/></Field>
 <Field id="library-customer" label="Customer filter"><select id="library-customer" value={customer} onChange={e=>{setCustomer(e.target.value);setSite('')}}><option value="">All customers</option>{customers.map(c=><option key={c}>{c}</option>)}</select></Field>
 <Field id="library-site" label="Site filter"><select id="library-site" value={site} onChange={e=>setSite(e.target.value)}><option value="">All sites</option>{sites.map(s=><option key={s}>{s}</option>)}</select></Field>
 <Field id="library-type" label="Document type"><select id="library-type" value={type} onChange={e=>setType(e.target.value)}><option value="">All document types</option>{[...new Set(['Survey draft','BOQ','Quotation','C&I proposal','IPO / PT',...records.map(r=>r.type)])].map(t=><option key={t}>{t}</option>)}</select></Field>
 </div>
 <div className="pz-action-row"><Button variant="neutral" onClick={()=>{setQuery('');setCustomer('');setSite('');setType('')}}>Clear filters</Button></div>
 {mode==='projects'&&<><h3>Projects ({projectGroups.length})</h3>{projectGroups.map(d=><div className="project-next" key={d.project_key}><div><strong><a href={`/dashboard#workspace=projects&project=${encodeURIComponent(d.project_key)}`}>{d.customer} · {d.site||'Site not recorded'}</a></strong><p>{d.site_code||'Site code not entered'} · {familyLabel(d.family)}</p></div><Button variant="secondary" onClick={()=>setProjectKey(d.project_key)}>Open project</Button></div>)}{!loading&&!projectGroups.length&&<p>No projects match these filters.</p>}<h3>Project actions</h3><div className="pz-action-row">{[['boqs','Surveys & BOQs'],['quotes','Quotations'],['orders','IPOs'],['operations','BOQs to Operations']].map(([target,label])=><Button key={target} variant="secondary" onClick={()=>onOpen({target})}>{label}</Button>)}</div><p>Open the selected saved document below for its exact project context.</p></>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 {loading?<p role="status">Loading your documents…</p>:<><p>{visible.length} documents · saved records / versions available to your account.</p>
 <div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>Reference</th><th>Type</th><th>Customer / Site</th><th>Pending action</th><th>Action</th></tr></thead><tbody>{visible.map(r=>{const pending=tasks.find(t=>t.id===r.id||t.id===r.proposal_id||t.boq_revision_id===r.id||t.ipo_id===r.id);return <tr key={r.type+r.id}><td><a href={`/dashboard#workspace=documents&document=${r.id}`}>{r.number}</a>{r.version!=null&&<small>Version {r.version}</small>}<small>{r.created_at?displayDate(r.created_at):'Saved date unavailable'}</small></td><td>{r.type}</td><td>{r.customer}<br/>{r.site||'Site not recorded'}{r.site_code&&<small>Site code: {r.site_code}</small>}</td><td>{pending?.stage??r.stage??'No pending task in your workspace'}{r.version_status&&<small>{r.version_status}</small>}{r.status_explanation&&<small>{r.status_explanation}</small>}</td><td><div className="pz-action-row"><Button variant="neutral" onClick={()=>{const d=catalog.find(d=>d.id===r.id||d.proposal_id===r.id);if(d)setProjectKey(d.project_key)}} disabled={!catalog.some(d=>d.id===r.id||d.proposal_id===r.id)}>View project</Button><Button variant="neutral" onClick={()=>setPreview({record:r,stage:pending?.stage??r.stage??"Saved"})}>Preview</Button><Button variant="secondary" onClick={()=>onOpen(r.type==='C&I proposal'?r.task:pending??r.task)}>{r.type==='C&I proposal'?'Open current workflow':'Open workflow'}</Button></div></td></tr>})}</tbody></table></div>{!visible.length&&<p>No documents match these filters. Clear filters or create a New BOQ.</p>}</>}
 </section>;
}

