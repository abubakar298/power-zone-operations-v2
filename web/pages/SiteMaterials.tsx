import {WorkspaceAccountMenu} from '../components/WorkspaceAccountMenu.js';
import {ManagementHeaderSwitcher} from '../components/ManagementHeaderSwitcher.js';
import {SavedVersionHistory} from '../inventory-approved/SavedVersionHistory.js';
import {ApprovedTransportFields} from '../inventory-approved/ApprovedTransportFields.js';
import {ApprovedMaterialForm} from '../inventory-approved/ApprovedMaterialForm.js';
import {navigateInventory} from '../inventory-approved/navigation.js';
import {InventoryMaterialTable,type MaterialPosition} from '../components/InventoryMaterialTable.js';
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
import {fixedPreparationRows,variablePreparationRows,type PreparationRow} from '../../shared/material-preparation.js';
import type {MaterialSource} from '../../server/inventory/material-drafts.js';
import type {SiteMaterialPlanInput} from '../../server/inventory/site-material-plans.js';
import './operations-board/operations-board.css';
import './parent-dos.css';

type StockItem={itemId:string;description:string;units:string[]};
type Intake={sources:MaterialSource[];catalogue:StockItem[];aliases?:Record<string,string>;warehouses:string[]};
type Detail={id:string;version:number;variableSupply:'single-site'|'parent-do';fixed:{snapshot:{sites:MaterialSource[];warehouse:string;transport:SiteMaterialPlanInput['transport'];lines:PreparationRow[]}};variable:{snapshot:{lines:PreparationRow[]}}|null};
const blankTransport=()=>({issuedTo:'',vehicle:'',driver:'',driverIdentity:''});
const labels={bess:'BESS',panels:'Panels, Structure and Earthing',other:'Other BOQ Items and Extras',customer:'Variable Material Issuance',internal:'Variable Mixed Items Issuance'};

/** A single site has one preparation screen and one atomic save. The two
 * variable groups stay visible even when their supply is deferred to a pool. */
export function SiteMaterials({session,onLogout}:{session:Session;onLogout:()=>void}){
 const initialId=location.pathname.split('/')[3]??'new';
 const requested=new URLSearchParams(location.search).get('site');
 const [intake,setIntake]=useState<Intake>(),[source,setSource]=useState<MaterialSource>(),[id,setId]=useState(initialId),[version,setVersion]=useState(0),[fixed,setFixed]=useState<PreparationRow[]>([]),[variable,setVariable]=useState<PreparationRow[]>([]),[warehouse,setWarehouse]=useState(''),[transport,setTransport]=useState(blankTransport),[supply,setSupply]=useState<'single-site'|'parent-do'>('single-site'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[mobile,setMobile]=useState(false);
 const [revisionReason,setRevisionReason]=useState('');
 const [partialDelivery,setPartialDelivery]=useState(false),[documents,setDocuments]=useState<{id:string;label:string;url:string}[]>([]),[previewRequest,setPreviewRequest]=useState(0);
 const issueRequest=useRef<{signature:string;key:string}|null>(null);
 const documentRequest=useRef(0);
 async function loadDocuments(planId:string){const ticket=++documentRequest.current;const data=await api<{dispatches:{id:string;number:string;variable:boolean}[]}>('/material-dispatches/site-plans/'+planId+'/issued');const choices=data.dispatches.flatMap(d=>[{id:d.id,label:d.number+' · DO',url:'/api/material-dispatches/issued/'+d.id+'/document.pdf'},...(d.variable?[{id:d.id+':signoff',label:d.number+' · Customer sign-off',url:'/api/material-dispatches/issued/'+d.id+'/customer-signoff.pdf'}]:[])]);if(ticket===documentRequest.current)setDocuments(choices);return choices;}
 useEffect(()=>{if(id!=='new'&&version>0)void loadDocuments(id).catch(e=>setError(e.message));},[id,version]);
 const [positions,setPositions]=useState<MaterialPosition[]>();
 useEffect(()=>{let active=true;setPositions(undefined);if(warehouse)void api<{positions:MaterialPosition[]}>('/material-dispatches/stock?warehouse='+encodeURIComponent(warehouse)).then(result=>{if(active)setPositions(result.positions);}).catch(()=>{});return()=>{active=false;};},[warehouse]);
 const saved=useRef(''),request=useRef<{signature:string;key:string}|null>(null);
 const signature=JSON.stringify({fixed,variable,warehouse,transport,supply});
 const dirty=!!intake&&!!saved.current&&signature!==saved.current;
 useUnsavedChanges(dirty);
 useEffect(()=>{if(dirty)setNotice('');},[dirty]);
 useEffect(()=>{let active=true;void (async()=>{
  try{
   const i=await api<Intake>('/material-dispatches/intake');
   let s:MaterialSource|undefined,rows:PreparationRow[],v:PreparationRow[]=[],w=i.warehouses.length===1?i.warehouses[0]:'',t=blankTransport(),route:'single-site'|'parent-do'='single-site';
   if(initialId==='new'){
    s=i.sources.find(v=>v.siteId===requested);if(!s)throw Error('This IPO is no longer pending or its approved BOQ link needs review.');
    rows=s.installationOnly?[]:fixedPreparationRows(s,i.catalogue,()=>crypto.randomUUID(),i.aliases??{});v=variablePreparationRows([s],i.catalogue,()=>crypto.randomUUID(),i.aliases??{});
   }else{
    const d=await api<Detail>('/material-dispatches/site-plans/'+initialId);s=d.fixed.snapshot.sites[0];rows=d.fixed.snapshot.lines;v=d.variable?.snapshot.lines??[];w=d.fixed.snapshot.warehouse;t=d.fixed.snapshot.transport;route=d.variableSupply;if(active)setVersion(d.version);
   }
   if(!active)return;
   saved.current=JSON.stringify({fixed:rows,variable:v,warehouse:w,transport:t,supply:route});setSource(s);setFixed(rows);setVariable(v);setWarehouse(w);setTransport(t);setSupply(route);setIntake(i);
  }catch(e){if(active)setError((e as Error).message);}
 })();return()=>{active=false;};},[]);
 function back(){navigateInventory('/inventory/parent-dos');}
 async function logout(){if(!confirmLeaveWorkspace())return;try{await api('/auth/logout',{csrf:session.csrfToken,body:{}});onLogout();}catch(e){setError((e as Error).message);}}
 async function save(){
  if(!source)return;setBusy(true);setError('');setNotice('');
  const body={...(id!=='new'?{id}:{}),version,source:{sourceKind:source.sourceKind,basisId:source.basisId,basisVersion:source.basisVersion,siteId:source.siteId},warehouse,transport,...(revisionReason.trim()?{revisionReason:revisionReason.trim()}:{}),fixedLines:fixed,variableLines:variable.map(({basisLine,...row})=>row),variableSupply:supply};
  const mark=JSON.stringify(body);if(request.current?.signature!==mark)request.current={signature:mark,key:crypto.randomUUID()};
  try{
   if(!dirty&&version>0&&documents.length){setPreviewRequest(v=>v+1);return;}
   const result=!dirty&&version>0?{id,version}:await api<{id:string;version:number}>('/material-dispatches/site-plans',{csrf:session.csrfToken,body:{...body,requestKey:request.current.key}});
   saved.current=signature;setId(result.id);setVersion(result.version);request.current=null;history.replaceState(null,'','/inventory/materials/'+result.id);const issueBody={version:result.version,partialDelivery,note:revisionReason.trim()||'Saved from material issuance'};const issueSignature=JSON.stringify({id:result.id,...issueBody});if(issueRequest.current?.signature!==issueSignature)issueRequest.current={signature:issueSignature,key:crypto.randomUUID()};
   const issued=await api<{id:string;number:string}>('/material-dispatches/site-plans/'+result.id+'/issue',{csrf:session.csrfToken,body:{...issueBody,requestKey:issueRequest.current.key}});issueRequest.current=null;await loadDocuments(result.id);setPreviewRequest(v=>v+1);setNotice(issued.number+' saved. Download the DO from Preview Documents. Signed gate evidence records the warehouse dispatch.');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function update(key:string,patch:Partial<PreparationRow>,isFixed:boolean){(isFixed?setFixed:setVariable)(old=>old.map(r=>r.key===key?{...r,...patch}:r));}
 function add(group:keyof typeof labels){if(!source)return;const isFixed=['bess','panels','other'].includes(group);const row:PreparationRow={key:crypto.randomUUID(),itemId:'',description:'',unit:'',out:'',sites:[source.siteId],...(isFixed?{fixedGroup:group as 'bess'|'panels'|'other'}:{section:group as 'customer'|'internal',documentPolicyVersion:2 as const})};(isFixed?setFixed:setVariable)(old=>[...old,row]);}
 function module(group:keyof typeof labels){
  const isFixed=['bess','panels','other'].includes(group),rows=(isFixed?fixed:variable).filter(r=>(isFixed?r.fixedGroup??'other':r.section??(materialDocumentPolicy(r).group==='internal-variable'?'internal':'customer'))===group);
  const choices=(intake?.catalogue??[]).filter(item=>{const policy=materialDocumentPolicy({itemId:item.itemId,description:item.description});return policy.group!=='non-stock'&&(isFixed?source?.installation===false||!policy.variableDispatch:policy.variableDispatch&&(policy.group==='internal-variable'?'internal':'customer')===group);});
  return <section className="pz-panel pz-stack" key={group} aria-label={labels[group]}><div className="ob-section-title"><h2>{labels[group]}</h2><Button variant="secondary" disabled={busy} onClick={()=>add(group)}>Add item</Button></div><InventoryMaterialTable rows={rows} catalogue={intake?.catalogue??[]} choices={choices} busy={busy} positions={positions} approved={r=>{const basis=(r.basisLine===undefined?source?.items.find((item:any)=>(item.description??item.key)===r.description):source?.items[r.basisLine]) as any;return basis?`${basis.qty??'Not recorded'} ${basis.unit??''}`.trim():'';}} onChange={(key,patch)=>update(key,patch,isFixed)} onRemove={key=>(isFixed?setFixed:setVariable)(old=>old.filter(row=>row.key!==key))}/>{!rows.length&&<p>No approved items in this group. Add a row only if an extra material is required.</p>}</section>;

 }
 return <div className="ob-shell"><header className="ob-header"><Button className="ob-mobile-toggle" aria-label="Open navigation" onClick={()=>setMobile(!mobile)}><Icon name="menu"/></Button><Brand compact/><div className="ob-header-actions"><ManagementHeaderSwitcher session={session} value="inventory"/><WorkspaceAccountMenu name={session.user.displayName} label={'Inventory'} onSignOut={()=>void logout()}/></div></header><InventoryNavigation mode="dispatcher" mobile={mobile}/><main className="ob-main"><Button className="ob-back" onClick={back}>Back to IPOs</Button>{error&&<p role="alert" className="form-error">{error}</p>}{!intake&&!error&&<p role="status">Loading approved material basis…</p>}{intake&&source&&<>
  <div className="ob-page-title"><div><h1>Material issuance</h1><p>{source.siteName}</p><small>{source.ipo??'Heads-up forecast'}{source.orderNumber?' · Order '+source.orderNumber:''}</small></div></div>{notice&&<p role="status" className="ob-success">{notice}</p>}
  <section className="pz-panel ob-editor pz-stack"><div className="ob-facts"><label>Warehouse<select disabled={busy} value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">Select warehouse</option>{intake.warehouses.map(w=><option key={w}>{w}</option>)}</select></label></div></section><ApprovedTransportFields session={session} warehouse={warehouse} value={transport} onChange={setTransport} disabled={busy}/>

  {version>0&&<SavedVersionHistory id={id} version={version} kind="site"/>}
  {version>0&&<section className="pz-panel pz-stack"><details><summary>Reason for revising an issued preparation</summary><label>Change reason<input value={revisionReason} onChange={e=>setRevisionReason(e.target.value)} maxLength={2000}/></label><small>Required when changing quantities or transport after a warehouse dispatch. Issued copies stay unchanged.</small></details></section>}
  <label className="issue-partial-choice"><input type="checkbox" checked={partialDelivery} disabled={busy} onChange={e=>setPartialDelivery(e.target.checked)}/> Partial delivery <small>Required only when fixed items are below the remaining approved BOQ. Variable quantities may differ.</small></label>
  <ApprovedMaterialForm source={source} fixed={fixed} variable={variable} warehouse={warehouse} catalogue={intake.catalogue} positions={positions} supply={supply} onSupply={setSupply} onParent={()=>navigateInventory('/inventory/parent-dos/new?sites='+encodeURIComponent(source.siteId))} onChange={update} onRemove={(key,isFixed)=>(isFixed?setFixed:setVariable)(old=>old.filter(row=>row.key!==key))} onAdd={(row,isFixed)=>(isFixed?setFixed:setVariable)(old=>[...old,row])}/>
  <div className="material-plan-actions inventory-issuance-final-actions"><Button variant="primary" disabled={busy||!warehouse} loading={busy} onClick={()=>void save()}>Save</Button><MaterialDocuments disabled={busy||dirty||!documents.length} documents={documents} openRequest={previewRequest}/></div>
  <section className="pz-panel pz-stack"><details><summary>Approved BOQ reference</summary><div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Material</th><th>Approved quantity</th><th>Unit</th></tr></thead><tbody>{source.items.map((r:any,i)=><tr key={i}><td>{r.description??r.key}</td><td>{r.qty==null?'Not recorded':<FinancialValue value={r.qty}/>}</td><td>{r.unit??'Not recorded'}</td></tr>)}</tbody></table></div></details></section>
 </>}</main></div>;
}
