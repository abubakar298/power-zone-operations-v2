import {useCallback,useEffect,useRef,useState} from 'react';
import {api,type Session} from '../../api.js';
import {Brand} from '../../components/Brand.js';
import {NotificationCenter} from '../../components/OperationsNotificationCenter.js';
import {Icon} from '../../components/Icon.js';
import {Button} from '../../ui/Button.js';
import {StatusBadge} from '../../ui/StatusBadge.js';
import {Field} from '../../ui/Field.js';
import {confirmLeaveWorkspace} from '../../hooks/useUnsavedChanges.js';
import {normalise,bucket,stageNames,teamName,day,sitePath,type Site,type Board,type Access} from './types.js';
import {SiteDetail} from './SiteDetail.js';
import {Vendors,Targets,Alerts} from './Workspaces.js';
import {Batches} from './Batches.js';
import './operations-board.css';
const links=[['sites','site','Site updates'],['vendors','users','Vendors'],['alerts','shield','Alerts'],['targets','rates','Stage targets'],['batches','file','Batch planning']] as const;
function route(){const parts=location.pathname.split('/').filter(Boolean);let id:string|undefined;try{id=parts[1]==='sites'&&parts[2]?decodeURIComponent(parts[2]):undefined;}catch{}return {page:parts[1]??'sites',id};}
export function OperationsBoard({session,onLogout}:{session:Session;onLogout:()=>void}){
 const [data,setData]=useState<Board>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[where,setWhere]=useState(route),[search,setSearch]=useState(''),[type,setType]=useState(''),[team,setTeam]=useState(''),[stage,setStage]=useState(''),[mobile,setMobile]=useState(false),[notice,setNotice]=useState('');
 const [canOpenProcurement,setCanOpenProcurement]=useState(false);
 useEffect(()=>{let active=true;setCanOpenProcurement(false);if(session.user.role==='Operations')void api<{buyer:boolean}>('/procurement/me').then(me=>{if(active)setCanOpenProcurement(me.buyer===true);}).catch(()=>{});return()=>{active=false;};},[session.user.id,session.user.role]);
 const currentPath=useRef(location.pathname+location.search);
 const load=useCallback(async()=>{setLoading(true);setError('');try{const result=await api<Board>('/operations-board/sites');setData({...result,sites:result.sites.map(normalise)});}catch(e){setError((e as Error).message);}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{const change=()=>{if(!confirmLeaveWorkspace()){history.pushState(null,'',currentPath.current);return;}currentPath.current=location.pathname+location.search;setWhere(route());};window.addEventListener('popstate',change);return()=>window.removeEventListener('popstate',change);},[]);
 function go(path:string){if(!confirmLeaveWorkspace())return false;history.pushState(null,'',path);currentPath.current=path;setWhere(route());setMobile(false);setNotice('');window.scrollTo(0,0);return true;}
 function saved(value:Site){setData(old=>old?{...old,sites:old.sites.map(s=>s.id===value.id?normalise(value):s)}:old);setNotice(`Saved ${value.ipo} · version ${value.version}`);}
 async function logout(){if(!confirmLeaveWorkspace())return;try{await api('/auth/logout',{csrf:session.csrfToken,body:{}});onLogout();}catch(e){setError((e as Error).message);}}
 const access=data?.access,supervisor=access?.kind==='owner'||access?.kind==='head';
 const scoped=(data?.sites??[]).filter(s=>(!team||s.operationsTeam===team)&&(!type||(type==='solar'?['solar','solar-bess'].includes(s.projectType??''):type==='ups'?s.projectType==='ups':s.installation===false)));
 const visible=scoped.filter(s=>(!stage||bucket(s)===stage)&&`${s.name} ${s.ipo} ${s.customer??''} ${s.customerPo??''}`.toLowerCase().includes(search.toLowerCase()));
 const restricted=access?.kind==='qc'&&['vendors','batches'].includes(where.page)||!supervisor&&where.page==='targets';
 const selected=where.id?data?.sites.find(s=>s.id===where.id):undefined;
 return <div className="operations-theme ob-shell">
  <header className="ob-header"><Button variant="neutral" className="ob-brand" onClick={()=>go('/operations/sites')}><Brand compact/></Button><Button variant="neutral" className="ob-mobile-toggle" aria-label="Toggle navigation" onClick={()=>setMobile(!mobile)}><Icon name="menu"/></Button><div className="ob-header-identity"><strong>{access?.name??session.user.displayName}</strong><small>{access?.kind==='qc'?'Quality control':access?.kind==='lead'?teamName(access.team):'Operations'}</small></div>{['Admin','Management'].includes(session.user.role)&&<Button variant="neutral" onClick={()=>{location.assign('/dashboard');}}>Management</Button>}{canOpenProcurement&&<Button variant="neutral" onClick={()=>{location.assign('/dashboard');}}>Procurement</Button>}<NotificationCenter session={session} onOpenPath={go} onOpen={()=>{setNotice('Open the relevant workspace to review this notification.');return false;}} /><Button variant="neutral" onClick={()=>void logout()}>Sign out</Button></header>
  <aside className={`ob-sidebar ${mobile?'is-open':''}`}><p className="ob-nav-caption">WORKSPACE</p><nav aria-label="Operations workspace">{access&&links.filter(([key])=>key!=='vendors'&&key!=='batches'||access?.kind!=='qc').filter(([key])=>key!=='targets'||supervisor).map(([key,icon,label])=><Button variant="neutral" key={key} className={where.page===key?'is-active':''} aria-current={where.page===key?'page':undefined} onClick={()=>go('/operations/'+key)}><Icon name={icon}/><span>{label}</span></Button>)}</nav><small className="ob-sidebar-foot">Power Zone · Operations</small></aside>
  <main className="ob-main" id="operations-main">
   {notice&&<p role="status" className="ob-success">{notice}</p>}
   {loading&&!data?<p role="status">Loading assigned sites…</p>:error?<section className="pz-panel pz-stack"><h1>Operations</h1><p className="form-error" role="alert">{error}</p><Button variant="primary" onClick={()=>void load()}>Try again</Button></section>:data&&<>
    {restricted?<section className="pz-panel pz-stack"><h1>Page unavailable</h1><p>This page is managed by your Operations lead.</p><Button variant="primary" onClick={()=>go('/operations/sites')}>Open assigned sites</Button></section>:where.id?<SiteDetail key={where.id} site={selected} siteId={where.id} access={data.access} session={session} onSaved={saved} onBack={()=>go('/operations/sites')} onBatches={()=>go('/operations/batches')}/>:
    where.page==='sites'?<>
     <div className="ob-page-title"><div><h1>Site updates</h1><p>{supervisor?'Plan dispatches and follow site progress.':`${teamName(access?.team)} · assigned sites`}</p></div><Button variant="neutral" loading={loading} onClick={()=>void load()}>Refresh</Button></div>
     <div className="ob-type-filters" aria-label="Project type">{[['solar','Solar'],['ups','UPS'],['delivery','Delivery-Only']].map(([id,label])=><Button variant="neutral" key={id} aria-pressed={type===id} className={type===id?'selected':''} onClick={()=>setType(type===id?'':id)}>{label}</Button>)}</div>
     <section className="ob-buckets" aria-label="Site stages">{Object.entries(stageNames).map(([id,label])=><Button variant="neutral" key={id} className={`ob-bucket ${stage===id?'selected':''}`} aria-pressed={stage===id} onClick={()=>setStage(stage===id?'':id)}><span>{label}</span><strong>{scoped.filter(s=>bucket(s)===id).length}</strong><small>{id==='received'?'Prepare the team and dispatch':id==='awaiting'?'Delivery evidence due':id==='delivered'?'Installation or QC pending':'Work complete · track originals'}</small></Button>)}</section>
     <section className="pz-panel pz-stack"><div className="ob-section-title"><h2>{stage?stageNames[stage as keyof typeof stageNames]:'All sites'}</h2><span>{visible.length} sites</span></div><div className="ob-search-row"><Field id="ob-search" label="Search site, IPO or customer PO"><input id="ob-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Site name or reference"/></Field>{supervisor&&<Field id="ob-team-filter" label="Operations team"><select id="ob-team-filter" value={team} onChange={e=>setTeam(e.target.value)}><option value="">All teams</option><option value="central">Central Operations</option><option value="south">South Operations</option></select></Field>}{<Button variant="neutral" disabled={!stage&&!type&&!search&&!team} onClick={()=>{setStage('');setType('');setSearch('');setTeam('');}}>Clear filters</Button>}</div>
      <div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Site / IPO</th><th>Operations team</th><th>Stage</th><th>Dispatch</th><th>Action</th></tr></thead><tbody>{visible.map(s=><tr key={s.id}><td><strong>{s.name}</strong><small>{s.ipo}{s.program?` · ${s.program}`:''}</small></td><td>{teamName(s.operationsTeam)}</td><td><StatusBadge tone={bucket(s)==='completed'?'success':s.scopePending?'warning':'pending'}>{s.scopePending?'Scope needs confirmation':stageNames[bucket(s) as keyof typeof stageNames]}</StatusBadge></td><td>{day(s.dispatchDate)}</td><td><Button variant="secondary" onClick={()=>go(sitePath(s.id))}>Open site</Button></td></tr>)}</tbody></table>{!visible.length&&<div className="ob-empty"><h3>No matching sites</h3><p>{data.sites.length?'Clear a filter or search another reference.':'Sites appear here when they are assigned to your team.'}</p></div>}</div>
     </section>
    </>:where.page==='vendors'?<Vendors session={session}/>:where.page==='targets'?<Targets session={session} access={data.access}/>:where.page==='alerts'?<Alerts onOpen={id=>go(sitePath(id))}/>:where.page==='batches'?<Batches sites={data.sites} session={session} access={data.access} onSaved={()=>void load()}/>:<section className="pz-panel"><h1>Page not found</h1><Button variant="primary" onClick={()=>go('/operations/sites')}>Open site updates</Button></section>}
   </>}
  </main>
 </div>;
}
