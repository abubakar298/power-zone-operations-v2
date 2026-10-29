import {Icon} from './Icon.js';
import {staffNavigationIcon} from './staff-navigation-icons.js';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {bucketCounts} from '../workspaces/bucket-counts.js';
import {bucketLabel,designBuckets,coordinationBuckets,visibleCoordinationBuckets} from '../workspaces/project-routes.js';
export function SidebarBuckets({department,page,onSelect}:{department:'design'|'coordination';page:string;onSelect:(bucket:string)=>void}){
 const [counts,setCounts]=useState<Record<string,number>|null>(null);
 const [error,setError]=useState(false);
 useEffect(()=>{
  let active=true,sequence=0;
  const refresh=async()=>{const current=++sequence;try{const result=await api<{records:any[];legacyTasks:any[]}>(`/project-workflow?department=${department}&scope=mine`);if(active&&current===sequence){setCounts(bucketCounts(department,result.records,result.legacyTasks));setError(false);}}catch{if(active)setError(true);}};
  const supplied=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.department===department&&detail.scope==='mine'){++sequence;setCounts(bucketCounts(department,detail.records,detail.legacyTasks));setError(false);}};
  void refresh();const timer=setInterval(refresh,15000);
  window.addEventListener('focus',refresh);window.addEventListener('pz:bucket-records',supplied);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('pz:bucket-records',supplied);};
 },[department]);
 return <>{(department==='design'?designBuckets:visibleCoordinationBuckets).map(bucket=><button key={bucket} className={page===bucket?'nav-active':''} aria-current={page===bucket?'page':undefined} onClick={()=>onSelect(bucket)}><Icon name={staffNavigationIcon(bucketLabel(bucket))}/><span className="sidebar-bucket-label">{bucketLabel(bucket)}</span><span className="sidebar-bucket-count" aria-label={error?'Document count unavailable':counts?`${counts[bucket]} documents`:'Loading document count'} title={error?'Unable to refresh count':undefined}>{error?'—':counts?.[bucket]??'…'}</span></button>)}</>;
}
