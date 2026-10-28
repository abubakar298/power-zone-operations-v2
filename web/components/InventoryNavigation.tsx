import {Button} from '../ui/Button.js';
import {Icon} from './Icon.js';
import {confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import './inventory-navigation.css';

export type InventorySection='dashboard'|'stock'|'minimum-stock'|'purchase-receiving'|'materials'|'site-ledger'|'parent-dos'|'reconciliations'|'gate-passes'|'transfers'|'replacements'|'all-documents'|'igps'|'ogps'|'transfer-documents'|'replacement-documents'|'copies-pending';
export const inventoryMenu:ReadonlyArray<{id:InventorySection;label:string;path:string;icon:string}>=[
 {id:'dashboard',label:'Dashboard',path:'/inventory',icon:'dashboard'},
 {id:'stock',label:'Stock Position',path:'/inventory/stock',icon:'site'},
 {id:'minimum-stock',label:'Minimum Closing Stock',path:'/inventory/minimum-stock',icon:'rates'},
 {id:'purchase-receiving',label:'Purchase receiving',path:'/inventory/purchase-receiving',icon:'arrow'},
 {id:'materials',label:'Material issuance',path:'/inventory/materials',icon:'file'},
 {id:'site-ledger',label:'Site ledger',path:'/inventory/site-ledger',icon:'site'},
 {id:'parent-dos',label:'Parent DO reconciliation',path:'/inventory/parent-dos/review',icon:'file'},
 {id:'reconciliations',label:'Inventory reconciliations',path:'/inventory/reconciliations',icon:'shield'},
 {id:'gate-passes',label:'Gate passes',path:'/inventory/gate-passes',icon:'file'},
 {id:'transfers',label:'Warehouse transfers',path:'/inventory/transfers',icon:'arrow'},
 {id:'replacements',label:'Replacements',path:'/inventory/replacements',icon:'file'},
];
export const storekeeperMenu:ReadonlyArray<{id:InventorySection;label:string;icon:string}>=[
 {id:'all-documents',label:'All documents',icon:'file'},
 {id:'igps',label:'IGPs',icon:'arrow'},
 {id:'ogps',label:'OGPs',icon:'arrow'},
 {id:'transfer-documents',label:'Warehouse transfers',icon:'site'},
 {id:'replacement-documents',label:'Replacements',icon:'file'},
 {id:'copies-pending',label:'Signed copies pending',icon:'shield'},
];
export type InventoryNavigationProps={mode?:'dispatcher'|'storekeeper';storekeeper?:boolean;active?:InventorySection;mobile?:boolean;onNavigate?:(path:string)=>void;onSelect?:(section:InventorySection)=>void};
/** One stable Inventory sidebar. Permissions remain enforced by each server endpoint. */
export function InventoryNavigation({mode='dispatcher',storekeeper=false,active,mobile=false,onNavigate,onSelect}:InventoryNavigationProps){
 const limited=storekeeper||mode==='storekeeper';
 const selected=active??(location.pathname.startsWith('/inventory/parent-dos')&&!location.pathname.startsWith('/inventory/parent-dos/review')?'materials':undefined)??inventoryMenu.find(item=>item.path!=='/inventory'&&(location.pathname===item.path||location.pathname.startsWith(item.path+'/')))?.id??'dashboard';
 function navigate(path:string){if(onNavigate){onNavigate(path);return;}if(confirmLeaveWorkspace())location.assign(path);}
 return <aside className={`ob-sidebar inventory-sidebar ${mobile?'is-open':''}`}>
  <p className="ob-nav-caption">{limited?'WAREHOUSE DOCUMENTS':'WORKSPACE'}</p>
  <nav aria-label={limited?'Storekeeper documents':'Inventory navigation'}>{limited?storekeeperMenu.map(item=><Button key={item.id} className={selected===item.id?'is-active':''} aria-current={selected===item.id?'page':undefined} onClick={()=>onSelect?onSelect(item.id):navigate('/inventory/gate-passes?view='+item.id)}><Icon name={item.icon}/><span>{item.label}</span></Button>):inventoryMenu.map((item,index)=><div key={item.id}>{index===1&&<p className="ob-nav-caption inventory-nav-group">PROJECT OPERATIONS</p>}<Button className={selected===item.id?'is-active':''} aria-current={selected===item.id?'page':undefined} onClick={()=>navigate(item.path)}><Icon name={item.icon}/><span>{item.label}</span></Button></div>)}</nav>
  <div className="ob-sidebar-foot">Power Zone · Inventory</div>
 </aside>;
}
