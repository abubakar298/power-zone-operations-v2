import {DispatchReconciliationPage} from './DispatchReconciliationPage.js';
import {ApprovedParentReconciliation} from '../inventory-approved/ApprovedParentReconciliation.js';
import {SiteLedger} from '../inventory-approved/ApprovedSiteLedger.js';
import {TemporaryDocuments} from '../inventory-approved/TemporaryDocuments.js';
import {ClosingReconciliations} from '../inventory-approved/ClosingReconciliations.js';
import {ApprovedInventoryWorkspace} from '../inventory-approved/ApprovedInventoryWorkspace.js';
import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {clearDepartmentUser} from '../department-view.js';
import {Button} from '../ui/Button.js';
import {InventoryHome} from './InventoryHome.js';
import {ParentDos} from './ParentDos.js';
import {SiteMaterials} from './SiteMaterials.js';
import {InventoryReviews} from './InventoryReviews.js';
import {WarehouseTransfers} from './WarehouseTransfers.js';
import {MaterialReplacements} from './MaterialReplacements.js';
import {GatePasses} from './GatePasses.js';
/** Actual Inventory logins follow their explicit capabilities; no generic
 * Inventory role grants storekeepers the dispatcher's editing workspace. */
export function InventoryRoleGate({session,onLogout}:{session:Session;onLogout:()=>void}){
 const [path,setPath]=useState(location.pathname+location.search);
 useEffect(()=>{const update=()=>setPath(location.pathname+location.search);window.addEventListener('inventory:navigate',update);window.addEventListener('popstate',update);return()=>{window.removeEventListener('inventory:navigate',update);window.removeEventListener('popstate',update);};},[]);
 const [kind,setKind]=useState<string>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(['Admin','Management'].includes(session.user.role))clearDepartmentUser();let active=true;void api<{kind:string}>('/material-dispatches/access').then(result=>{if(!active)return;if(result.kind==='storekeeper')history.replaceState(null,'','/inventory/gate-passes');if(['dispatcher','management'].includes(result.kind)&&!location.pathname.startsWith('/inventory')){history.replaceState(null,'','/inventory');setPath('/inventory');}setKind(result.kind);setError('');}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[session.user.id,attempt]);
 if(error)return <section className="pz-panel pz-stack"><p role="alert">{error}</p><Button onClick={()=>{setError('');setAttempt(v=>v+1);}}>Try again</Button></section>;
 if(!kind)return <p role="status">Opening your assigned Inventory workspace…</p>;
 if(kind==='storekeeper')return <GatePasses session={session} onLogout={onLogout} limitedAccess/>;
 if(kind==='dispatcher'||kind==='management'){
  const props={session,onLogout};
  const content=(()=>{
  const usagePath=path.split('?')[0].match(/^\/inventory\/materials\/([^/]+)\/usage\/?$/);if(usagePath)return <DispatchReconciliationPage/>;
  if(path.startsWith('/inventory/site-ledger'))return <SiteLedger/>;
  if(path.startsWith('/inventory/temporary-documents'))return <TemporaryDocuments session={session} initialCreate/>;
  if(path.startsWith('/inventory/materials/')||path.split('?')[0]==='/inventory/materials'&&new URLSearchParams(location.search).has('site'))return <SiteMaterials key={path} {...props}/>;
  if(path.startsWith('/inventory/parent-dos/review'))return <ApprovedParentReconciliation key={path} session={session}/>;
  if(path.startsWith('/inventory/parent-dos')||path.split('?')[0]==='/inventory/materials')return <ParentDos key={path} {...props}/>;
  if(path.startsWith('/inventory/reconciliations'))return <ClosingReconciliations/>;
  if(path.startsWith('/inventory/transfers'))return <WarehouseTransfers key={path} {...props}/>;
  if(path.startsWith('/inventory/replacements'))return <MaterialReplacements key={path} {...props}/>;
  if(path.startsWith('/inventory/gate-passes'))return <GatePasses key={path} {...props}/>;
  return <InventoryHome key={path} {...props} assignedKind={kind}/>;
  })();
  return <ApprovedInventoryWorkspace session={session} onLogout={onLogout} path={path}>{content}</ApprovedInventoryWorkspace>;
 }
 return <section className="pz-panel pz-stack"><h1>Inventory access pending</h1><p>Management must assign your warehouse and responsibilities before this workspace opens.</p><Button onClick={()=>void api('/auth/logout',{csrf:session.csrfToken,body:{}}).then(onLogout).catch(e=>setError(e.message))}>Sign out</Button></section>;
}
