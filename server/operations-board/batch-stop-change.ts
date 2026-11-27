/** How an edited batch stop changed for one site. Delivery and installation cancellations and
 * postponements get their own event kinds, so Inventory and QC are told plainly, with the
 * reason, instead of a general "plan changed" notice. */
type Work='delivery'|'labour'|'both';
type Visit={kind:Work;plannedDate?:string};
export type StopChangeKind='Batch delivery cancelled'|'Batch installation cancelled'|'Batch installation postponed'|'Batch plan changed';
export const batchCancellationKinds=['Batch delivery cancelled','Batch installation cancelled','Batch installation postponed'] as const;
export function batchStopChange(before:Visit,after:Visit):StopChangeKind{
 const delivered=(v:Visit)=>v.kind!=='labour',installed=(v:Visit)=>v.kind!=='delivery';
 if(delivered(before)&&!delivered(after))return 'Batch delivery cancelled';
 if(installed(before)&&!installed(after))return 'Batch installation cancelled';
 if(installed(before)&&installed(after)&&before.plannedDate&&after.plannedDate&&after.plannedDate>before.plannedDate)return 'Batch installation postponed';
 return 'Batch plan changed';
}
/** Tells Inventory which issued DOs need a decision after delivery is taken off a batch. */
export const issuedDosNote=(dos:string[])=>dos.length?` DOs already issued for this site: ${dos.join(', ')}. Inventory to review them.`:'';
/** After a cancelled delivery: which DOs were cancelled automatically and which Inventory must review. */
export function cancelledDeliveryDosNote(dos:{cancelled:string[];kept:string[]}){
 return (dos.cancelled.length?` ${dos.cancelled.length===1?'DO':'DOs'} ${dos.cancelled.join(', ')} cancelled automatically (not yet signed at the gate); Inventory issues a fresh DO for the new delivery date.`:'')
  +(dos.kept.length?` ${dos.kept.length===1?'DO':'DOs'} ${dos.kept.join(', ')} already left the warehouse, is signed or is a Parent DO, so ${dos.kept.length===1?'it was':'they were'} kept: Inventory to review.`:'');
}
/** One history line per change; the notification shows it as the detail. */
export function batchStopChangeHistory(kind:StopChangeKind,input:{number:string;deliveryDate?:string;before:Visit;after:Visit;reason:string;dos:{cancelled:string[];kept:string[]}}):string|null{
 const dos=cancelledDeliveryDosNote(input.dos);
 const reason=input.reason?` Reason: ${input.reason}`:'';
 if(kind==='Batch delivery cancelled')return `${input.number}: delivery cancelled; installation stays planned for ${input.after.plannedDate||'a date to be confirmed'}.${reason}${dos}`;
 if(kind==='Batch installation cancelled')return `${input.number}: installation cancelled; delivery stays on ${input.deliveryDate??'the batch date'}. VSO and acknowledgment are not due yet.${reason}`;
 if(kind==='Batch installation postponed')return `${input.number}: installation postponed from ${input.before.plannedDate} to ${input.after.plannedDate}. VSO and acknowledgment are not due until then.${reason}`;
 return null;
}
