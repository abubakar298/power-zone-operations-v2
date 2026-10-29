import {ManagementHeaderSwitcher} from '../components/ManagementHeaderSwitcher.js';
import {WorkspaceAccountMenu} from '../components/WorkspaceAccountMenu.js';
import {useEffect,useState,type ReactNode} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Brand} from '../components/Brand.js';
import {Icon} from '../components/Icon.js';
import {confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import {navigateInventory} from './navigation.js';
import {NotificationCenter} from '../components/OperationsNotificationCenter.js';
import './workspace.css';
export const approvedInventoryMenu=[["Stock Position","/inventory/stock"],["Minimum Closing Stock","/inventory/minimum-stock"],["Purchase receiving","/inventory/purchase-receiving"],["Material issuance","/inventory/materials"],["Documents Upload","/inventory/gate-passes"],["Site ledger","/inventory/site-ledger"],["Parent DO reconciliation","/inventory/parent-dos/review"],["Warehouse transfers","/inventory/transfers"],["Replacements","/inventory/replacements"],["Closing reconciliations","/inventory/reconciliations"]] as const;
export function ApprovedInventoryWorkspace({session,onLogout,path,children,documentOnly=false,onCreateTemporary}:{session:Session;onLogout:()=>void;path:string;children:ReactNode;documentOnly?:boolean;onCreateTemporary?:()=>void}){
 const [mobile,setMobile]=useState(false),[error,setError]=useState('');
 useEffect(()=>setMobile(false),[path]);
 function go(to:string){if(confirmLeaveWorkspace())navigateInventory(to);}
 const active=(to:string)=>to==='/inventory/materials'?path.startsWith('/inventory/materials')||path.startsWith('/inventory/parent-dos')&&!path.startsWith('/inventory/parent-dos/review'):path.split('?')[0]===to||path.startsWith(to+'/');
 return <div className={'approved-live-inventory'+(documentOnly?' approved-storekeeper-inventory':'')}><header className="approved-inventory-topbar"><Button variant="neutral" className="approved-brand" onClick={()=>go('/inventory')}><Brand compact/></Button><span className="approved-breadcrumb">Workspace / <strong>Inventory</strong></span><div className="approved-header-actions"><Button variant="primary" onClick={()=>onCreateTemporary?onCreateTemporary():go('/inventory/temporary-documents')}>Create Temporary Document</Button><NotificationCenter session={session} onOpen={()=>false} onOpenPath={to=>{if(!confirmLeaveWorkspace())return false;navigateInventory(to);return true;}}/><ManagementHeaderSwitcher session={session} value="inventory"/><WorkspaceAccountMenu name={session.user.displayName} label={documentOnly?'Storekeeper':'Inventory'} onSignOut={()=>{if(!confirmLeaveWorkspace())return;void api('/auth/logout',{csrf:session.csrfToken,body:{}}).then(onLogout).catch(e=>setError(e.message));}}/></div><Button className="approved-mobile-menu" aria-label="Toggle navigation" onClick={()=>setMobile(!mobile)}><Icon name="menu"/></Button></header>{!documentOnly&&<aside className={'approved-inventory-sidebar '+(mobile?'is-open':'')}><div className="approved-nav-caption">WORKSPACE</div><Button className={path==='/inventory'?'nav-active':''} onClick={()=>go('/inventory')}><Icon name="dashboard"/>Dashboard</Button><div className="approved-nav-divider"/><div className="approved-nav-caption">PROJECT OPERATIONS</div>{approvedInventoryMenu.map(([label,to])=><Button key={to} className={active(to)?'nav-active':''} aria-current={active(to)?'page':undefined} onClick={()=>go(to)}><Icon name="file"/>{label}</Button>)}</aside>}<div className="approved-inventory-content">{error&&<p role="alert">{error}</p>}{children}</div></div>;
}
