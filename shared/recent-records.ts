const dateFields=['updatedAt','updated_at','modifiedAt','lastUpdatedAt','latestAt','createdAt','created_at','started_at','recordedAt','recorded_at','receivedAt','received_at','sharedAt','issuedAt','submittedAt','submitted_at','closedDate','poDate','po_date','ipoDate','orderedAt','preparedAt','lastActivityAt','date'];
/** Actual recorded dates only; planned/expected dates never make a record look recent. */
export function recordedTimestamp(value:unknown):number{
 if(!value||typeof value!=='object')return 0;
 const row=value as Record<string,unknown>;
 const timestamps=dateFields.map(key=>{
  const v=row[key];
  if(v instanceof Date)return Number.isFinite(v.getTime())?v.getTime():0;
  if(typeof v==='number')return v>1e11?v:0;
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v))return 0;
  const time=Date.parse(v);return Number.isFinite(time)?time:0;
 });
 return Math.max(0,...timestamps);
}
/** Newest recorded activity first; undated registered rows use their monotonic numeric ID. */
export function recentFirst<T>(rows:readonly T[],getTime:(row:T)=>number=recordedTimestamp):T[]{
 const id=(row:T)=>{const value=(row as any)?.id;return /^\d+$/.test(String(value??''))?Number(value):0;};
 return rows.map((row,index)=>({row,index,time:getTime(row)})).sort((a,b)=>b.time-a.time||(!a.time&&!b.time?id(b.row)-id(a.row):0)||a.index-b.index).map(r=>r.row);
}
