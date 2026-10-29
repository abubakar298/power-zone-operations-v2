import {InventoryBatchList,InventoryBatchDetail} from '../inventory-approved/InventoryBatchQueue.js';
import {WorkspaceAccountMenu} from '../components/WorkspaceAccountMenu.js';
import {ManagementHeaderSwitcher} from '../components/ManagementHeaderSwitcher.js';
import {SavedVersionHistory} from '../inventory-approved/SavedVersionHistory.js';
import {ApprovedTransportFields} from '../inventory-approved/ApprovedTransportFields.js';
import {ApprovedMaterialForm} from '../inventory-approved/ApprovedMaterialForm.js';
import {navigateInventory} from '../inventory-approved/navigation.js';
import type {InventoryBatch} from '../../server/inventory/operations-batches.js';
import {InventoryMaterialTable,type MaterialPosition} from '../components/InventoryMaterialTable.js';
import {variablePreparationRows} from '../../shared/material-preparation.js';
import {InventoryNavigation} from '../components/InventoryNavigation.js';
import {useEffect,useRef,useState} from 'react';
import {api,type Session} from '../api.js';
import {Brand} from '../components/Brand.js';
import {FinancialValue} from '../ui/FinancialValue.js';
import {Icon} from '../components/Icon.js';
import {Button} from '../ui/Button.js';
import {MaterialDocuments} from '../components/MaterialDocuments.js';
import {useUnsavedChanges,confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import type {MaterialSource,MaterialDraftInput} from '../../server/inventory/material-drafts.js';
import './operations-board/operations-board.css';
import './parent-dos.css';

type StockItem={itemId:string;description:string;units:string[]};
type Intake={operationsBatches?:InventoryBatch[];access:{owner:boolean;warehouses:string[]};sources:MaterialSource[];registeredPending?:{siteId:string;ipo:string;siteName:string;customer:string;linkStatus:string}[];catalogue:StockItem[];aliases?:Record<string,string>;warehouses:string[]};
type Draft={id:string;version:number;snapshot:{warehouse:string;sites:MaterialSource[];kind:'fixed'|'variable';parent:boolean;lines:MaterialDraftInput['lines'];transport:MaterialDraftInput['transport']};created_at:string};
type Slot=Omit<MaterialDraftInput['lines'][number],'section'>&{section:'customer'|'internal'};
const base='/inventory/parent-dos';
const blankTransport=()=>({issuedTo:'',vehicle:'',driver:'',driverIdentity:''});
const section=(item:StockItem)=>materialDocumentPolicy({itemId:item.itemId,description:item.description}).group==='internal-variable'?'internal':'customer';

export function ParentDos({session,onLogout}:{session:Session;onLogout:()=>void}){
 const [intake,setIntake]=useState<Intake>(),[drafts,setDrafts]=useState<Draft[]>([]),[plans,setPlans]=useState<{id:string;siteId:string}[]>([]),[path,setPath]=useState(location.pathname+location.search),[search,setSearch]=useState(''),[selected,setSelected]=useState<string[]>([]),[selecting,setSelecting]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[mobile,setMobile]=useState(false),[notice,setNotice]=useState('');
 const pathRef=useRef(path),draftId=path.split('?')[0].slice(base.length+1),editing=draftId!=='';
 async function load(){setError('');try{const [i,d,p]=await Promise.all([api<Intake>('/material-dispatches/intake'),api<{drafts:Draft[]}>('/material-dispatches/drafts'),api<{plans:{id:string;siteId:string}[]}>('/material-dispatches/site-plans')]);setPlans(p.plans);setIntake(i);setDrafts(d.drafts.filter(r=>r.snapshot.parent&&r.snapshot.kind==='variable'));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();const pop=()=>{if(!confirmLeaveWorkspace()){history.pushState(null,'',pathRef.current);return;}const value=location.pathname+location.search;pathRef.current=value;setPath(value);};window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 function go(value:string,check=true){if(check&&!confirmLeaveWorkspace())return;history.pushState(null,'',value);pathRef.current=value;setPath(value);setMobile(false);window.scrollTo(0,0);}
 const sources=(intake?.sources??[]).filter(s=>selecting||!!s.dispatchDate).sort((a,b)=>(a.dispatchDate??'9999').localeCompare(b.dispatchDate??'9999')).filter(s=>`${s.ipo??''} ${s.orderNumber??''} ${s.siteName} ${s.customer}`.toLowerCase().includes(search.toLowerCase()));
 const registered=(intake?.registeredPending??[]).filter(s=>`${s.ipo} ${s.siteName} ${s.customer}`.toLowerCase().includes(search.toLowerCase()));
 const requested=new URLSearchParams(path.split('?')[1]??'').get('sites')?.split(',')??[];
 const batchId=new URLSearchParams(path.split('?')[1]??'').get('operations-batch');
 const activeBatch=intake?.operationsBatches?.find(batch=>batch.id===batchId);
 async function logout(){if(!confirmLeaveWorkspace())return;try{await api('/auth/logout',{csrf:session.csrfToken,body:{}});onLogout();}catch(e){setError((e as Error).message);}}
 return <div className="ob-shell"><header className="ob-header"><Button className="ob-mobile-toggle" aria-label="Open navigation" onClick={()=>setMobile(!mobile)}><Icon name="menu"/></Button><Brand compact/><div className="ob-header-actions"><ManagementHeaderSwitcher session={session} value="inventory"/><WorkspaceAccountMenu name={session.user.displayName} label={'Inventory'} onSignOut={()=>void logout()}/></div></header>
  <InventoryNavigation mode="dispatcher" mobile={mobile}/>
  <main className="ob-main">{error&&<section className="pz-panel pz-stack"><p role="alert" className="form-error">{error}</p><Button onClick={()=>void load()}>Try again</Button></section>}
   {!intake&&!error&&<p role="status">Loading material requests…</p>}
   {notice&&<p role="status" className="ob-success">{notice}</p>}{intake&&(editing?<ParentEditor key={draftId} id={draftId} requested={requested} intake={intake} session={session} onBack={()=>go(base)} onDirty={()=>setNotice('')} onSaved={async(id,issued)=>{await load();setNotice('Parent DO saved.');go(base+'/'+id+(issued?'?issued='+issued:''),false);}}/>:batchId?<InventoryBatchDetail batch={activeBatch} plans={plans} onBack={()=>go('/inventory/materials')} onParent={ids=>go(base+'/new?sites='+ids.map(encodeURIComponent).join(','))}/>:<>
    <div className="ob-page-title"><h1>Material issuance</h1><Button loading={busy} onClick={async()=>{setBusy(true);await load();setBusy(false);}}>Refresh</Button></div>

    <section className="pz-panel pz-stack"><div className="parent-start"><label className="pz-field">Search IPO or site<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="parent-start-action"><Button variant="primary" disabled={selecting&&!selected.length} onClick={()=>{if(!selecting){setSelecting(true);return;}go(base+'/new?sites='+selected.map(encodeURIComponent).join(','));}}>{selecting?`Continue to Parent DO (${selected.length})`:'Create Parent DO'}</Button>{selecting&&<Button onClick={()=>{setSelecting(false);setSelected([]);}}>Cancel selection</Button>}</div></div>
    <InventoryBatchList batches={intake.operationsBatches??[]} onView={batch=>go('/inventory/materials?operations-batch='+encodeURIComponent(batch.id))}/>
     <div className="pz-table-scroll"><table className="ob-table"><thead><tr>{selecting&&<th>Select</th>}<th>IPO / request</th><th>Site</th><th>Customer</th><th>Scheduled delivery date</th>{!selecting&&<th>Action</th>}</tr></thead><tbody>{(selecting||search.trim()?sources:sources.slice(0,10)).map(s=><tr key={s.sourceKind+s.basisId+s.siteId}>{selecting&&<td><input type="checkbox" aria-label={`Select ${s.siteName}`} checked={selected.includes(s.siteId)} onChange={e=>setSelected(old=>e.target.checked?[...old,s.siteId]:old.filter(id=>id!==s.siteId))}/></td>}<td><strong>{s.ipo??'Heads-up BOQ'}</strong>{s.orderNumber&&<small>Order {s.orderNumber}</small>}{s.authorization==='forecast-only'&&<small>Forecast only · preparation draft</small>}</td><td>{s.siteName}</td><td>{s.customer}</td><td>{s.dispatchDate||'Date not set'}</td>{!selecting&&<td><Button variant="secondary" onClick={()=>{const saved=plans.find(p=>p.siteId===s.siteId);navigateInventory('/inventory/materials/'+(saved?saved.id:'new?site='+encodeURIComponent(s.siteId)));}}>Open materials</Button></td>}</tr>)}{(selecting?registered:[]).map(s=><tr key={'registered:'+s.siteId}>{selecting&&<td><input type="checkbox" disabled aria-label={`Approved BOQ link required for ${s.siteName}`}/></td>}<td><strong>{s.ipo}</strong><small>Approved BOQ link required</small></td><td>{s.siteName}</td><td>{s.customer}</td>{!selecting&&<td><small>BOQ link required</small></td>}</tr>)}</tbody></table></div>{!sources.length&&!registered.length&&<p>No material requests match this search.</p>}
    </section>
   </>)}
  </main></div>;
}

function ParentEditor({id,requested,intake,session,onBack,onDirty,onSaved}:{id:string;requested:string[];intake:Intake;session:Session;onBack:()=>void;onDirty:()=>void;onSaved:(id:string,issued?:string)=>Promise<void>}){
 const [loaded,setLoaded]=useState(id==='new'),[version,setVersion]=useState(0),[sites,setSites]=useState<MaterialSource[]>(()=>intake.sources.filter(s=>requested.includes(s.siteId))),[rows,setRows]=useState<Slot[]>([]),[warehouse,setWarehouse]=useState(intake.warehouses.length===1?intake.warehouses[0]:''),[transport,setTransport]=useState(blankTransport),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [revisionReason,setRevisionReason]=useState('');
 const [documents,setDocuments]=useState<{id:string;label:string;url:string}[]>([]),[signoffs,setSignoffs]=useState<{id:string;label:string;url:string}[]>([]),[previewRequest,setPreviewRequest]=useState(0);
 const issueRequest=useRef<{signature:string;key:string}|null>(null);
 async function loadDocuments(draft:string){const value=await api<{dispatches:{id:string;number:string;hasSignoffs:boolean}[]}>('/material-dispatches/drafts/'+draft+'/movements');setDocuments(value.dispatches.map(d=>({id:d.id,label:d.number+' · Parent DO',url:'/api/material-dispatches/issued/'+d.id+'/document.pdf'})));setSignoffs(value.dispatches.filter(d=>d.hasSignoffs).map(d=>({id:d.id,label:d.number+' · All customer sign-offs',url:'/api/material-dispatches/drafts/'+draft+'/customer-signoffs?dispatch='+d.id})));}
 useEffect(()=>{if(id!=='new')void loadDocuments(id).then(()=>{if(new URLSearchParams(location.search).has('issued'))setPreviewRequest(v=>v+1);}).catch(e=>setError(e.message));},[id]);
 const [positions,setPositions]=useState<MaterialPosition[]>();
 useEffect(()=>{let active=true;setPositions(undefined);if(warehouse)void api<{positions:MaterialPosition[]}>('/material-dispatches/stock?warehouse='+encodeURIComponent(warehouse)).then(result=>{if(active)setPositions(result.positions);}).catch(()=>{});return()=>{active=false;};},[warehouse]);
 const savedSignature=useRef(''),requestIdentity=useRef<{signature:string;key:string}|null>(null);
 const stateSignature=JSON.stringify({rows,warehouse,transport});
 const dirty=loaded&&savedSignature.current!==''&&stateSignature!==savedSignature.current;
 useUnsavedChanges(dirty);
 useEffect(()=>{if(dirty){onDirty();setNotice('');}},[dirty]);
 useEffect(()=>{if(id==='new'){const seeded=variablePreparationRows(sites,intake.catalogue,()=>crypto.randomUUID(),intake.aliases??{}) as Slot[];setRows(seeded);savedSignature.current=JSON.stringify({rows:seeded,warehouse:intake.warehouses.length===1?intake.warehouses[0]:'',transport:blankTransport()});return;}
  let active=true;void api<Draft>('/material-dispatches/drafts/'+id).then(d=>{if(!active)return;const next=d.snapshot.lines.map(r=>({...r,section:r.section??(materialDocumentPolicy(r).group==='internal-variable'?'internal' as const:'customer' as const)}));setRows(next);setWarehouse(d.snapshot.warehouse);setTransport(d.snapshot.transport);setSites(d.snapshot.sites);setVersion(d.version);savedSignature.current=JSON.stringify({rows:next,warehouse:d.snapshot.warehouse,transport:d.snapshot.transport});setLoaded(true);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[id]);
 function update(key:string,patch:Partial<Slot>){setRows(old=>old.map(r=>r.key===key?{...r,...patch}:r));setNotice('');}
 const variableItems=intake.catalogue.filter(i=>materialDocumentPolicy({itemId:i.itemId,description:i.description}).variableDispatch);
 function add(which:Slot['section']){setRows(old=>[...old,{documentPolicyVersion:2,key:crypto.randomUUID(),itemId:'',description:'',unit:'',out:'',sites:sites.map(s=>s.siteId),section:which}]);setNotice('');}
 async function save(){setBusy(true);setError('');const body={...(id!=='new'?{id}:{}),version,kind:'variable' as const,parent:true,warehouse,...(revisionReason.trim()?{revisionReason:revisionReason.trim()}:{}),sites:sites.map(s=>({sourceKind:s.sourceKind,basisId:s.basisId,basisVersion:s.basisVersion,siteId:s.siteId})),lines:rows,transport};const signature=JSON.stringify(body);if(requestIdentity.current?.signature!==signature)requestIdentity.current={signature,key:crypto.randomUUID()};
  try{const result=!dirty&&version>0?{id,version}:await api<{id:string;version:number}>('/material-dispatches/drafts',{csrf:session.csrfToken,body:{...body,requestKey:requestIdentity.current.key}});setVersion(result.version);savedSignature.current=stateSignature;setNotice('');requestIdentity.current=null;const issueBody={version:result.version,note:revisionReason.trim()||'Saved Parent DO material issuance'};const signature=JSON.stringify({id:result.id,...issueBody});if(issueRequest.current?.signature!==signature)issueRequest.current={signature,key:crypto.randomUUID()};const issued=await api<{id:string;number:string}>('/material-dispatches/drafts/'+result.id+'/issue-saved',{csrf:session.csrfToken,body:{...issueBody,requestKey:issueRequest.current.key}});issueRequest.current=null;await loadDocuments(result.id);setPreviewRequest(v=>v+1);await onSaved(result.id,issued.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(!loaded)return <section className="pz-panel pz-stack">{error?<p role="alert">{error}</p>:<p role="status">Loading Parent DO draft…</p>}<Button onClick={onBack}>Back to IPOs</Button></section>;
 return <><Button className="ob-back" onClick={onBack}>Back to IPOs</Button><div className="ob-page-title"><div><h1>Parent DO draft</h1><p>{sites.map(s=>s.siteName).join(' · ')}</p></div></div>{error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="ob-success">{notice}</p>}
  <section className="pz-panel"><h2>Sites in batch</h2><div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>IPO</th><th>Site</th><th>Customer</th><th>Work type</th></tr></thead><tbody>{sites.map(site=><tr key={site.siteId}><td>{site.ipo}</td><td>{site.siteName}</td><td>{site.customer}</td><td>{site.installationOnly?'Installation only':site.installation===false?'Delivery only':'Delivery + installation'}</td></tr>)}</tbody></table></div></section>
  <section className="pz-panel ob-editor pz-stack"><div className="ob-facts"><label>Warehouse<select value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">Select warehouse</option>{intake.warehouses.map(w=><option key={w}>{w}</option>)}</select></label></div></section><ApprovedTransportFields session={session} warehouse={warehouse} value={transport} onChange={setTransport} disabled={busy}/>
  {version>0&&<SavedVersionHistory id={id} version={version} kind="parent"/>}
  {version>0&&<section className="pz-panel pz-stack"><details><summary>Reason for revising an issued preparation</summary><label>Change reason<input value={revisionReason} onChange={e=>setRevisionReason(e.target.value)} maxLength={2000}/></label><small>Required when changing quantities or transport after a warehouse dispatch. Issued copies stay unchanged.</small></details></section>}
  {sites.length>0&&<div className="approved-parent-form"><ApprovedMaterialForm variableOnly source={{...sites[0],siteName:sites.map(s=>s.siteName).join(' · '),ipo:sites.map(s=>s.ipo).filter(Boolean).join(' · '),items:sites.flatMap(s=>s.items),installation:true}} fixed={[]} variable={rows} warehouse={warehouse} catalogue={intake.catalogue} positions={positions} supply="single-site" onSupply={()=>{}} onParent={()=>{}} onChange={(key,patch)=>update(key,patch)} onRemove={key=>setRows(old=>old.filter(row=>row.key!==key))} onAdd={row=>setRows(old=>[...old,{...row,sites:sites.map(s=>s.siteId),section:row.section??'customer'}])}/></div>}

  <div className="material-plan-actions inventory-issuance-final-actions"><Button variant="primary" loading={busy} disabled={!sites.length||!warehouse} onClick={()=>void save()}>Save</Button><MaterialDocuments disabled={busy||dirty||!documents.length} documents={documents} openRequest={previewRequest}/><MaterialDocuments disabled={busy||dirty||!signoffs.length} documents={signoffs} triggerLabel="Download all customer sign-offs"/></div>
  <section className="pz-panel pz-stack"><details><summary>Approved BOQ references</summary>{sites.map(s=><div className="ob-history" key={s.siteId}><strong>{s.siteName}</strong><small>{s.ipo??'Heads-up forecast'}{s.orderNumber?' · Order '+s.orderNumber:''}{s.authorization==='forecast-only'?' · forecast only':''}</small><div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Material</th><th>Approved quantity</th><th>Unit</th></tr></thead><tbody>{s.items.map((value:any,i)=><tr key={i}><td>{value.description??value.key}</td><td>{value.qty==null?'Not recorded':<FinancialValue value={value.qty}/>}</td><td>{value.unit??'Not recorded'}</td></tr>)}</tbody></table></div></div>)}</details></section>
 </>;
}
