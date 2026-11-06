export function awaitingClosures(rows:any[]){return rows.filter(r=>r.stage==='Awaiting Management');}
export function pendingTechnicalPackages(packages:any[],records:any[]){
 return packages.filter(p=>p.status==='Submitted for Management').map(p=>({...p,pendingSites:(p.snapshot?.sites??[]).flatMap((s:any)=>{const r=records.find(r=>r.id===s.recordId&&r.stage==='management_review'&&r.data?.ublSurveyPackageId===p.id);return r?[{...s,version:r.version}]:[];})})).filter(p=>p.pendingSites.length);
}
export function pendingBoqReviews(rows:any[]){
 const latest=new Map<string,any>();
 for(const r of rows){const old=latest.get(r.draft_id);if(!old||r.draft_version>old.draft_version||r.draft_version===old.draft_version&&r.created_at>old.created_at)latest.set(r.draft_id,r);}
 return [...latest.values()].filter(r=>r.status==='Awaiting review');
}
