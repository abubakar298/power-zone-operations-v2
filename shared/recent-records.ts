/**
 * The one ordering rule for record lists across the portal: the most recently changed,
 * uploaded or received record comes first.
 *
 * "Most recent" is the latest real, recorded time on the record — updated, changed,
 * uploaded, received, submitted, last activity — falling back to its created time.
 * Planned or expected dates (dispatch plans, survey schedules, delivery targets) are never
 * used, and text shown on screen is never parsed for ordering.
 */
const dateFields=[
 'lastActivityAt','last_activity_at',
 'updatedAt','updated_at','modifiedAt','modified_at','lastUpdatedAt','changedAt','changed_at','latestAt',
 'uploadedAt','uploaded_at','receivedAt','received_at','submittedAt','submitted_at','sentAt','sent_at',
 'approvedAt','approved_at','cancelledAt','cancelled_at','recordedAt','recorded_at','sharedAt','issuedAt','issued_at','closedAt','closed_at',
 'createdAt','created_at','started_at','closedDate','poDate','po_date','ipoDate','orderedAt','preparedAt','date',
];
const parseTime=(v:unknown):number=>{
 if(v instanceof Date)return Number.isFinite(v.getTime())?v.getTime():0;
 if(typeof v==='number')return v>1e11?v:0;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v))return 0;
 const time=Date.parse(v);return Number.isFinite(time)?time:0;
};
/** Actual recorded dates only; planned/expected dates never make a record look recent. */
export function recordedTimestamp(value:unknown):number{
 if(!value||typeof value!=='object')return 0;
 const row=value as Record<string,unknown>;
 return Math.max(0,...dateFields.map(key=>parseTime(row[key])));
}
/** The latest of several recorded times, as an ISO string for list payloads; null when none is recorded. */
export function latestActivity(...values:unknown[]):string|null{
 const time=Math.max(0,...values.map(parseTime));
 return time?new Date(time).toISOString():null;
}
/** Newest recorded activity first; undated registered rows use their monotonic numeric ID. */
export function recentFirst<T>(rows:readonly T[],getTime:(row:T)=>number=recordedTimestamp):T[]{
 const id=(row:T)=>{const value=(row as any)?.id;return /^\d+$/.test(String(value??''))?Number(value):0;};
 return rows.map((row,index)=>({row,index,time:getTime(row)})).sort((a,b)=>b.time-a.time||(!a.time&&!b.time?id(b.row)-id(a.row):0)||a.index-b.index).map(r=>r.row);
}
