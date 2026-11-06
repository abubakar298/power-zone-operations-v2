import {ListPagination,useListPage,paginateRows} from '../ui/ListPagination.js';
import './coordinator-library.css';
import {ProjectDocumentActions} from '../components/ProjectDocumentActions.js';
import type {Session} from '../api.js';
import {displayDate} from '../../server/display/dates.js';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {LibraryDocumentPreview,type PreviewDocument} from '../components/LibraryDocumentPreview.js';
import {ProjectWorkspace,familyLabel} from './ProjectWorkspace.js';
import {Field} from '../ui/Field.js';
type RecordLink=PreviewDocument & {task:any;project_key?:string;site_code?:string;proposal_id?:string;created_at?:string;version?:number;version_status?:string;status_explanation?:string};
/** Read-only navigation index. Existing endpoints remain the authority for ownership. */
export function CoordinatorLibrary({mode,onOpen,active,initialProjectKey,initialDocumentId,session}:{session:Session;initialDocumentId?:string;initialProjectKey?:string;mode:'projects'|'documents';active:boolean;onOpen:(task:any)=>void}) {
 const [records,setRecords]=useState<RecordLink[]>([]),[tasks,setTasks]=useState<any[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[masters,setMasters]=useState<any>({customers:[],sites:[]});
 const [projectKey,setProjectKey]=useState<string>(),[catalog,setCatalog]=useState<any[]>([]);
 useEffect(()=>{if(initialProjectKey)setProjectKey(initialProjectKey)},[initialProjectKey]);
 const [handledDocumentId,setHandledDocumentId]=useState<string>();
 const [preview,setPreview]=useState<{record:RecordLink;stage:string}>();
 useEffect(()=>{if(!active)setPreview(undefined)},[active]);
 useEffect(()=>{if(mode==='documents')setProjectKey(undefined)},[mode]);
 const [filtersOpen,setFiltersOpen]=useState(false);
 const [query,setQuery]=useState(''),[customer,setCustomer]=useState(''),[site,setSite]=useState(''),[type,setType]=useState('');
 useEffect(()=>{if(!active)return;let alive=true;async function load(){try{
 const [w,m,d,p]=await Promise.all([api<any>('/coordinator?scope=mine'),api<any>('/masters'),session.user.role==='Coordinator'?Promise.resolve({drafts:[]}):api<any>('/boqs/drafts'),api<any>('/coordinator/projects')]);
 const links:RecordLink[]=(p.documents??[]).map((r:any)=>({...r,pdfUrl:r.pdf_url,inputs:r.resource==='draft'?d.drafts?.find((x:any)=>x.id===r.id)?.inputs:undefined}));
 if(alive){setCatalog(p.documents??[]);setMasters(m);setRecords(links);setTasks(w.tasks??[]);setError('');}
 }catch(e){if(alive)setError((e as Error).message);}finally{if(alive)setLoading(false);}}void load();return()=>{alive=false};},[active]);
 useEffect(()=>{if(!initialDocumentId||loading||handledDocumentId===initialDocumentId)return;setHandledDocumentId(initialDocumentId);const record=records.find(r=>r.id===initialDocumentId);if(record)setPreview({record,stage:record.stage??"Saved"});else setError('This saved document is unavailable to your account.');},[initialDocumentId,records,loading,handledDocumentId]);
 const customers:string[]=[...new Set<string>([...records.map(r=>r.customer),...masters.customers.map((r:any)=>r.name)].filter(Boolean))].sort();
 const sites:string[]=[...new Set<string>([...records.filter(r=>!customer||r.customer===customer).map(r=>r.site),...masters.sites.filter((r:any)=>!customer||r.customer_name===customer).map((r:any)=>r.name)].filter(Boolean))].sort();
 const matches=(r:any)=>(!customer||r.customer===customer)&&(!site||r.site===site)&&(!type||r.type===type)&&`${r.number} ${r.customer} ${r.site} ${r.site_code??''}`.toLowerCase().includes(query.trim().toLowerCase());
 const [page,setPage]=useListPage(JSON.stringify([query,customer,site,type,mode]));
 const projectGroups=[...new Map([...catalog].filter(matches).reverse().map(d=>[d.project_key,d])).values()].sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
 const hasProjectFilters=Boolean(query.trim()||customer||site||type);
 const pagination=paginateRows(projectGroups,page),shownProjects=pagination.rows;
 const visible=records.filter(matches);
 if(projectKey)return <ProjectWorkspace projectKey={projectKey} onBack={()=>setProjectKey(undefined)} onOpen={onOpen} session={session}/>;
 if(preview&&!(session.user.role==='Coordinator'&&catalog.find(d=>d.id===preview.record.id)?.resource!=='boq'))return <LibraryDocumentPreview document={preview.record} stage={preview.stage} onBack={()=>setPreview(undefined)}/>;
 return <section className="pz-panel pz-stack coordinator-library" aria-busy={loading}>
 <header><h2>{mode==='projects'?'Customer & site work':'Document library'}</h2><p>{mode==='projects'?'Search a customer or site to open its project.':'Search saved documents by reference, customer or site.'}</p></header>
 <div className="library-search-bar">
 <Field id="library-search" label="Search projects and documents"><input id="library-search" type="search" placeholder="Customer, site, code or document reference" value={query} onChange={e=>setQuery(e.target.value)}/></Field>
 <Button variant="neutral" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(value=>!value)}>Filters</Button>
 <Button variant="neutral" disabled={!query&&!customer&&!site&&!type} onClick={()=>{setQuery('');setCustomer('');setSite('');setType('')}}>Clear filters</Button>
 </div>
 {filtersOpen&&<div className="library-filter-panel">
 <Field id="library-customer" label="Customer"><select id="library-customer" value={customer} onChange={e=>{setCustomer(e.target.value);setSite('')}}><option value="">All customers</option>{customers.map(c=><option key={c}>{c}</option>)}</select></Field>
 <Field id="library-site" label="Site"><select id="library-site" value={site} onChange={e=>setSite(e.target.value)}><option value="">All sites</option>{sites.map(value=><option key={value}>{value}</option>)}</select></Field>
 <Field id="library-type" label="Document type"><select id="library-type" value={type} onChange={e=>setType(e.target.value)}><option value="">All document types</option>{[...new Set(records.map(r=>r.type))].map(value=><option key={value}>{value}</option>)}</select></Field>
 </div>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 {loading?<p role="status">Loading your projects…</p>:mode==='projects'?<>
 <h3>{hasProjectFilters?`Matching projects (${shownProjects.length})`:`Recent projects (${shownProjects.length})`}</h3><div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>SR#</th><th>Customer / site</th><th>Project type</th><th>Latest document</th><th>Updated</th><th>Next action</th></tr></thead><tbody>{shownProjects.map((d,i)=><tr key={d.project_key}><td>{pagination.start+i+1}</td><td><strong>{d.customer}</strong><small>{d.site||'Site not recorded'}{d.site_code?' · '+d.site_code:''}</small></td><td>{familyLabel(d.family)}</td><td><strong>{d.number||d.type}</strong><small>{d.type}</small></td><td>{d.created_at?displayDate(d.created_at):'Not recorded'}</td><td><Button variant="secondary" onClick={()=>setProjectKey(d.project_key)}>Open project</Button></td></tr>)}</tbody></table></div>{!shownProjects.length&&<p>No projects match these filters.</p>}<ListPagination pagination={pagination} onPageChange={setPage} label="projects"/>
 </>:<><p>{visible.length} saved documents</p><div className="pz-table-scroll"><table className="pz-table"><thead><tr><th>Reference</th><th>Type</th><th>Customer / site</th><th>Stage</th><th>Next action</th></tr></thead><tbody>{visible.map(r=>{const document=catalog.find(d=>d.id===r.id)||r,pending=tasks.find(t=>t.id===r.id||t.id===r.proposal_id||t.boq_revision_id===r.id||t.ipo_id===r.id);return <tr key={r.type+r.id}><td><strong>{r.number}</strong><small>{r.version!=null?'Version '+r.version:''}{r.created_at?' · '+displayDate(r.created_at):''}</small></td><td>{r.type}</td><td><strong>{r.customer}</strong><small>{r.site||'Site not recorded'}</small></td><td>{pending?.stage??r.stage??'Saved'}{r.version_status&&<small>{r.version_status}</small>}</td><td>{session.user.role==='Coordinator'?<ProjectDocumentActions record={document} session={session} onOpen={onOpen} onPreview={()=>setPreview({record:r,stage:r.stage??'Saved'})}/>:<div className="pz-action-row"><Button variant="neutral" onClick={()=>setPreview({record:r,stage:r.stage??'Saved'})}>Preview</Button><Button variant="secondary" onClick={()=>onOpen(r.task)}>Open workflow</Button></div>}</td></tr>})}</tbody></table></div>{!visible.length&&<p>No documents match these filters.</p>}</>}
 </section>;
}
