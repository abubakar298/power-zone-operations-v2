import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {Dashboard} from './Dashboard.js';
import {GatePasses} from './GatePasses.js';
/** Actual Inventory logins follow their explicit capabilities; no generic
 * Inventory role grants storekeepers the dispatcher's editing workspace. */
export function InventoryRoleGate({session,onLogout}:{session:Session;onLogout:()=>void}){
 const [kind,setKind]=useState<string>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;void api<{kind:string}>('/material-dispatches/access').then(result=>{if(!active)return;if(result.kind==='storekeeper')history.replaceState(null,'','/inventory/gate-passes');setKind(result.kind);setError('');}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[session.user.id,attempt]);
 if(error)return <section className="pz-panel pz-stack"><p role="alert">{error}</p><Button onClick={()=>{setError('');setAttempt(v=>v+1);}}>Try again</Button></section>;
 if(!kind)return <p role="status">Opening your assigned Inventory workspace…</p>;
 if(kind==='storekeeper')return <GatePasses session={session} onLogout={onLogout}/>;
 if(kind==='dispatcher'||kind==='management')return <Dashboard session={session} onLogout={onLogout}/>;
 return <section className="pz-panel pz-stack"><h1>Inventory access pending</h1><p>Management must assign your warehouse and responsibilities before this workspace opens.</p><Button onClick={()=>void api('/auth/logout',{csrf:session.csrfToken,body:{}}).then(onLogout).catch(e=>setError(e.message))}>Sign out</Button></section>;
}
