import {ApprovedInventoryWorkspace} from '../inventory-approved/ApprovedInventoryWorkspace.js';
import {TemporaryDocuments} from '../inventory-approved/TemporaryDocuments.js';
import {confirmLeaveWorkspace,useUnsavedChanges} from '../hooks/useUnsavedChanges.js';
import {WorkspaceAccountMenu} from '../components/WorkspaceAccountMenu.js';
import {ManagementHeaderSwitcher} from '../components/ManagementHeaderSwitcher.js';
import {navigateInventory} from '../inventory-approved/navigation.js';
import {useEffect,useRef,useState} from 'react';
import {api,type Session} from '../api.js';
import {Brand} from '../components/Brand.js';
import {InventoryNavigation} from '../components/InventoryNavigation.js';
import {Button} from '../ui/Button.js';
import {MaterialDocuments} from '../components/MaterialDocuments.js';
import './inventory-document-upload.css';
import {DocumentPreview} from '../components/DocumentPreview.js';
import './operations-board/operations-board.css';
import '../components/warehouse-movements.css';
type Kind='dispatch'|'return'|'purchase'|'transfer-out'|'transfer-in'|'replacement-out'|'replacement-in';
type Record={kind:Kind;id:string;number:string;warehouse:string;created_at:string;signed_copies:number;parent?:boolean;siteId?:string;siteName?:string;ipo?:string;signoff?:boolean};
type Copy={id:string;copy_kind:string;source_site_id:string|null;evidence_id:string;note:string;created_at:string};
type Queue={kind:string;warehouses:string[];records:Record[];signoffs:Record[]};
type Bucket='dos'|'irrs'|'purchases'|'transfers'|'replacements';
const buckets:{id:Bucket;title:string;description:string;kinds:Kind[]}[]=[
 {id:'dos',title:'DOs dispatched',description:'Individual and Parent DOs · download and upload signed copies.',kinds:['dispatch']},
 {id:'irrs',title:'IRRs',description:'Customer sign-offs and signed IGPs for material returned from site.',kinds:['return']},
 {id:'purchases',title:'Purchases',description:'Purchase IGPs and signed warehouse receiving copies.',kinds:['purchase']},
 {id:'transfers',title:'Transfers',description:'Transfer DOs, signed gate copies and receiving warehouse copies.',kinds:['transfer-out','transfer-in']},
 {id:'replacements',title:'Replacements',description:'Replacement DOs and verified faulty-return IGPs.',kinds:['replacement-out','replacement-in']}
];
const labels:{[K in Kind]:string}={dispatch:'Delivery order',return:'Site return IGP',purchase:'Purchase IGP','transfer-out':'Transfer DO','transfer-in':'Receiving warehouse IGP','replacement-out':'Replacement DO','replacement-in':'Faulty return IGP'};
const copyLabel=(kind:string)=>kind==='customer-signoff'?'Signed customer sign-off':kind==='signed-customer'?'Customer receiving copy':kind==='signed-gate'?'Signed gate copy':'Signed store copy';
export function GatePasses({session,onLogout,limitedAccess=false}:{session:Session;onLogout:()=>void;limitedAccess?:boolean}){
 const [data,setData]=useState<Queue>(),[selected,setSelected]=useState<Record>(),[copies,setCopies]=useState<Copy[]>([]),[bucket,setBucket]=useState<Bucket>(()=>{const value=new URLSearchParams(location.search).get('bucket');return buckets.some(b=>b.id===value)?value as Bucket:'dos';});
 const [search,setSearch]=useState(''),[warehouse,setWarehouse]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[file,setFile]=useState<File>(),[note,setNote]=useState(''),[copyKind,setCopyKind]=useState('signed-gate'),[temporary,setTemporary]=useState(false);
 const upload=useRef<HTMLInputElement>(null),retry=useRef<{signature:string;key:string}|null>(null),dirty=!!file||!!note;
 const limited=limitedAccess||data?.kind==='storekeeper';
 useUnsavedChanges(dirty);
 async function load(){try{setData(await api<Queue>('/material-dispatches/gate-passes'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
 function leave(){return !busy&&confirmLeaveWorkspace();}
 function clear(){setSelected(undefined);setFile(undefined);setNote('');setError('');setNotice('');if(upload.current)upload.current.value='';}
 function choose(next:Bucket){if(!leave())return;clear();setBucket(next);setSearch('');history.replaceState(null,'','/inventory/gate-passes?bucket='+next);}
 const records=(id:Bucket)=>id==='irrs'?[...(data?.signoffs??[]),...(data?.records.filter(r=>r.kind==='return')??[])]:data?.records.filter(r=>buckets.find(b=>b.id===id)!.kinds.includes(r.kind))??[];
 const visible=records(bucket).filter(r=>(!warehouse||r.warehouse===warehouse)&&`${r.number} ${r.siteName??''} ${r.ipo??''} ${r.warehouse}`.toLowerCase().includes(search.toLowerCase()));
 const relevant=(all:Copy[],r:Record)=>all.filter(c=>r.signoff?c.copy_kind==='customer-signoff'&&c.source_site_id===r.siteId:c.copy_kind!=='customer-signoff');
 async function open(r:Record){if(!leave())return;setBusy(true);setError('');try{const detail=await api<{copies:Copy[];parent:boolean}>('/material-dispatches/gate-passes/'+r.kind+'/'+r.id);setSelected({...r,parent:detail.parent});setCopies(relevant(detail.copies,r));setFile(undefined);setNote('');setNotice('');setCopyKind(r.signoff?'customer-signoff':['return','purchase','transfer-in','replacement-in'].includes(r.kind)?'signed-store':'signed-gate');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function save(){if(!selected||!file||busy)return;setBusy(true);setError('');try{
  if(file.size>15*1024*1024||!['application/pdf','image/png','image/jpeg'].includes(file.type))throw Error('Choose a PDF, PNG or JPEG up to 15 MB.');
  const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('The selected file could not be read.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
  const evidence=await api<{id:string}>('/material-dispatches/evidence',{csrf:session.csrfToken,body:{warehouse:selected.warehouse,filename:file.name,mediaType:file.type,base64}});
  const body={kind:selected.kind,documentId:selected.id,copyKind,...(selected.signoff?{siteId:selected.siteId}:{}),evidenceId:evidence.id,note:note.trim()||copyLabel(copyKind)+' uploaded'};
  const signature=JSON.stringify(body);if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
  await api('/material-dispatches/gate-pass-copies',{csrf:session.csrfToken,body:{...body,requestKey:retry.current.key}});retry.current=null;setFile(undefined);setNote('');if(upload.current)upload.current.value='';
  const detail=await api<{copies:Copy[]}>('/material-dispatches/gate-passes/'+selected.kind+'/'+selected.id);setCopies(relevant(detail.copies,selected));await load();setNotice(copyLabel(copyKind)+' saved.');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const recordUrl=(r:Record)=>r.signoff?'/api/material-dispatches/issued/'+r.id+'/customer-signoff.pdf?site='+r.siteId:'/api/material-dispatches/gate-passes/'+r.kind+'/'+r.id+'/document.pdf';
 const documentUrl=selected?(selected.signoff?'/api/material-dispatches/issued/'+selected.id+'/customer-signoff.pdf?site='+selected.siteId:'/api/material-dispatches/gate-passes/'+selected.kind+'/'+selected.id+'/document.pdf'):'';
 const page=<div className={'ob-shell'+(limited?' storekeeper-document-shell':'')}><header className="ob-header"><Brand compact/><div className="ob-header-actions">{limited&&<Button onClick={()=>{if(leave())setTemporary(true);}}>Create Temporary Document</Button>}<ManagementHeaderSwitcher session={session} value="inventory"/><WorkspaceAccountMenu name={session.user.displayName} label={limited?'Storekeeper':session.user.role} disabled={busy} onSignOut={()=>{if(leave())void api('/auth/logout',{csrf:session.csrfToken,body:{}}).then(onLogout).catch(e=>setError(e.message));}}/></div></header>{!limited&&<InventoryNavigation mode="dispatcher" active="gate-passes" onNavigate={path=>{if(leave())navigateInventory(path);}}/>}<main className={limited?'ob-main storekeeper-document-main':'ob-main'}>{temporary?<><Button onClick={()=>{if(leave())setTemporary(false);}}>Back to Documents Upload</Button><TemporaryDocuments session={session} initialCreate/></>:<>
  <div className="ob-page-title storekeeper-summary"><div><h1>Documents Upload</h1><p>Find the site or document, download its issued copy and upload signed evidence.</p>{data&&<p className="inventory-upload-scope-list"><strong>{session.user.displayName}</strong> · Warehouses: {data.warehouses.join(', ')}</p>}</div><Button disabled={busy} onClick={()=>{if(leave())void load();}}>Refresh</Button></div>
  {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="ob-success">{notice}</p>}
  <section className="pz-panel inventory-document-upload"><nav className="inventory-dashboard-buckets inventory-document-groups" aria-label="Document work buckets">{buckets.map(b=><button key={b.id} type="button" data-testid={'document-bucket-'+b.id} aria-pressed={bucket===b.id} className={bucket===b.id?'selected':''} onClick={()=>choose(b.id)}><strong>{records(b.id).length}</strong><span>{b.title}</span><small>{b.description}</small></button>)}</nav><div className="inventory-doc-bucket-content"><div className="inventory-upload-list-heading"><div><h2>{buckets.find(b=>b.id===bucket)!.title}</h2><small>{buckets.find(b=>b.id===bucket)!.description}</small></div><span>{visible.length} records</span></div><div className="inventory-upload-filters"><label>Search {buckets.find(b=>b.id===bucket)!.title.toLowerCase()} by site or reference<input type="search" placeholder="Site, IPO, DO, Parent DO or warehouse" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Warehouse<select value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">All assigned warehouses</option>{data?.warehouses.map(w=><option key={w}>{w}</option>)}</select></label></div>{!data&&!error?<p role="status">Loading documents…</p>:!visible.length?<p>No documents match this search.</p>:<div className="inventory-upload-list-items">{visible.map(r=>{const chosen=selected?.id===r.id&&selected?.signoff===r.signoff&&selected?.siteId===r.siteId;const downloadLabel=r.signoff?'Open customer sign-off':r.kind==='dispatch'?'Download DO':r.kind==='purchase'?'Download purchase IGP':r.kind==='transfer-out'?'Download transfer DO':r.kind==='replacement-out'?'Download replacement DO':'Download IGP';return <article className="inventory-upload-row" key={r.kind+r.id+(r.siteId??'')}><div className="inventory-upload-primary"><strong>{r.number}{r.parent?' · Parent DO':''}</strong><small>{r.signoff?'Customer sign-off':labels[r.kind]} · {r.warehouse}{r.siteName?' · '+r.siteName:''}</small><small>{r.ipo?r.ipo+' · ':''}{r.created_at.slice(0,10)} · {r.signed_copies} signed copies</small></div><div className="inventory-upload-task-actions"><MaterialDocuments documents={[{id:r.id+(r.siteId??''),label:r.signoff?'Customer sign-off':r.number,url:recordUrl(r)}]} triggerLabel={downloadLabel}/><Button variant="primary" disabled={busy} onClick={()=>void open(r)}>{['return','purchase','transfer-in','replacement-in'].includes(r.kind)?'Upload signed IGP':'Upload signed copy'}</Button>{chosen&&<div className="inventory-upload-inline">{r.kind==='dispatch'&&!r.signoff&&<label>Document copy<select value={copyKind} disabled={busy} onChange={e=>setCopyKind(e.target.value)}><option value="signed-gate">Signed gate copy</option>{!selected.parent&&<option value="signed-customer">Customer receiving copy</option>}</select></label>}<label>Signed file<input ref={upload} type="file" disabled={busy} accept="application/pdf,image/png,image/jpeg" onChange={e=>setFile(e.target.files?.[0])}/></label><label>Notes<textarea disabled={busy} value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label><Button variant="primary" loading={busy} disabled={!file} onClick={()=>void save()}>Save uploaded copy</Button><Button disabled={busy} onClick={()=>{if(leave())clear();}}>Cancel</Button>{copies.map(c=><div key={c.id}><a href={'/api/material-dispatches/evidence/'+c.evidence_id}>{copyLabel(c.copy_kind)}</a><small>{c.note}</small></div>)}</div>}</div></article>;})}</div>}</div></section>
 </>}</main></div>;
 return limited?<ApprovedInventoryWorkspace session={session} onLogout={onLogout} path="/inventory/gate-passes" documentOnly onCreateTemporary={()=>{if(leave()){clear();setTemporary(true);}}}>{page}</ApprovedInventoryWorkspace>:page;
}
