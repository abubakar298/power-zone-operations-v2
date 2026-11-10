import {Icon} from './Icon.js';
import {staffNavigationIcon} from './staff-navigation-icons.js';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {bucketCounts} from '../workspaces/bucket-counts.js';
import {shouldRefreshSidebar,sidebarRefreshIntervalMs} from '../workspaces/sidebar-refresh.js';
import {bucketLabel,designBuckets,coordinationBuckets,visibleCoordinationBuckets} from '../workspaces/project-routes.js';
export function SidebarBuckets({department,page,onSelect}:{department:'design'|'coordination';page:string;onSelect:(bucket:string)=>void}){
 const [counts,setCounts]=useState<Record<string,number>|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>{
  let active=true,sequence=0,inFlight=false,lastLoadedAt:number|undefined;
  const refresh=async()=>{if(!shouldRefreshSidebar({hidden:document.visibilityState==='hidden',inFlight,lastLoadedAt,now:Date.now()}))return;inFlight=true;const current=++sequence;try{const result=await api<{records:any[];legacyTasks:any[]}>(`/project-workflow?department=${department}&scope=mine`);if(active&&current===sequence){lastLoadedAt=Date.now();setCounts(bucketCounts(department,result.records,result.legacyTasks));setError(false);}}catch{if(active)setError(true);}finally{inFlight=false;}};
  const supplied=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.department===department&&detail.scope==='mine'){++sequence;lastLoadedAt=Date.now();setCounts(bucketCounts(department,detail.records,detail.legacyTasks));setError(false);}};
  void refresh();const timer=setInterval(refresh,sidebarRefreshIntervalMs);
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('pz:bucket-records',supplied);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('pz:bucket-records',supplied);};
 },[department]);
 return <>{(department==='design'?designBuckets:visibleCoordinationBuckets).map(bucket=><button key={bucket} className={page===bucket?'nav-active':''} aria-current={page===bucket?'page':undefined} onClick={()=>onSelect(bucket)}><Icon name={staffNavigationIcon(bucketLabel(bucket))}/><span className="sidebar-bucket-label">{bucketLabel(bucket)}</span><span className="sidebar-bucket-count" aria-label={error?'Document count unavailable':counts?`${counts[bucket]} documents`:'Loading document count'} title={error?'Unable to refresh count':undefined}>{error?'—':counts?.[bucket]??'…'}</span></button>)}</>;
}
