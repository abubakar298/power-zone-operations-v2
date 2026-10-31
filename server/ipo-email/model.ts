import {createHash} from 'node:crypto';
export const ipoEmailTo='recoverypzes@powerzone.com.pk';
export const ipoEmailCc=['nazir@powerzone.com.pk','hamzabutt@powerzone.com.pk','zahid@powerzone.com.pk','abubakar@powerzone.com.pk','moaz@powerzone.com.pk','shaiggan@powerzone.com.pk'];
export const ipoEmailStages=['PO / Evidence','Internal Purchase Order (IPO)','Delivery Note (DO) + Delivery Pictures','Variable Items Sign Off','Acknowledgment','Site Pictures'];
export type EmailIdentity={key:string;ipo:string;order:string;site:string;customer:string;subject:string};
const clean=(s:unknown)=>String(s??'').replace(/[\r\n\0]/g,' ').trim();
export function ipoIdentity(label:unknown,order:unknown='',site:unknown='',customer:unknown=''):EmailIdentity|null{
 const text=clean(label).toUpperCase(),match=text.match(/\b(?:CHP|CHJ)[ -]?\d+(?:-R\d*)?(?!\d)|\bCPZ-IPO-[A-Z0-9-]+/);
 if(!match)return null;
 const ipo=match[0].replace(/^(CHP|CHJ)[ -]?(\d+)(-R\d*)?$/,(_,p,n,r)=>p+'-'+String(BigInt(n))+(r??''));
 const found=(clean(order)||text).match(/\b(\d+)\s*\/\s*(\d+)\b/),position=found?String(BigInt(found[1]))+'/'+String(BigInt(found[2])):'';
 if(found&&(BigInt(found[1])<1n||BigInt(found[1])>BigInt(found[2])))return null;
 return {key:ipo+'|'+position,ipo,order:position,site:clean(site),customer:clean(customer),subject:`IPO: ${ipo}${position?' ('+position+')':''}${clean(customer)?' _ '+clean(customer):''}${clean(site)?' ('+clean(site)+')':''}`};
}
export function operationsEmailIdentity(site:any){
 // Imported programme IDs carry the exact order position even if the visible IPO is shared.
 const order=site.orderNumber??site.order_number??String(site.id??'').match(/(?:registered-|received-)(?:UBL|MBL):UPS:(\d+\/\d+)$/)?.[1]??'';
 return ipoIdentity(site.ipo,order,site.name,site.customer??site.customerName??'');
}
export const rfcMessageIds=(value:unknown)=>[...new Set((clean(value).match(/<[^<>\s\r\n]+@[^<>\s\r\n]+>/g)??[]).filter(x=>x.length<=500))];
export function references(ids:string[],last?:string|null){const all=[...new Set([...ids,...(last?rfcMessageIds(last):[])])];return all.length>20?[all[0],...all.slice(-19)]:all;}
export type Evidence={kind:'operations'|'po'|'workflow-po'|'ipo';id:string;siteId?:string};
export type StageEvidence={stage:number;files:Evidence[];detail:string};
export function operationsStageEvidence(site:any):StageEvidence[]{
 const result:StageEvidence[]=[],ref=(f:any):Evidence=>({kind:'operations',id:f.id,siteId:site.id});
 for(const [index,d]of(site.deliveries??[]).entries())if(d.signedDo?.id&&d.materialPhoto?.id)result.push({stage:3,files:[ref(d.signedDo),ref(d.materialPhoto)],detail:`${d.partial?'Partial delivery':'Delivery'} ${index+1} · ${d.deliveryDate}`});
 if(site.installation===true){
  for(const e of [site.qcJob,site.qc?.signoff,site.qc?.handover].filter(Boolean)){
   if(e.variableSignoff?.id)result.push({stage:4,files:[ref(e.variableSignoff)],detail:`Signed variable items · ${e.date}`});
   if(e.acknowledgement?.id)result.push({stage:5,files:[ref(e.acknowledgement)],detail:`Customer acknowledgment · ${e.date}`});
   const photos=[e.evidence,...(e.additionalEvidence??[])].filter(f=>f?.id&&f.mediaType?.startsWith('image/'));
   if(photos.length)result.push({stage:6,files:photos.map(ref),detail:`Site pictures · ${e.date}`});
  }
 }
 for(const d of site.documents??[]){
  if(d.id===`${site.id}:historical-delivery-documents`&&d.evidence?.length>=2)result.push({stage:3,files:d.evidence.slice(0,2).map(ref),detail:'Uploaded signed DO and material picture for existing delivery'});
  if(site.installation===true&&d.id===`${site.id}:historical-handover-documents`){
   if(d.evidence?.[2]?.id)result.push({stage:4,files:[ref(d.evidence[2])],detail:'Uploaded variable-items sign-off for existing installation'});
   if(d.evidence?.[0]?.id)result.push({stage:5,files:[ref(d.evidence[0])],detail:'Uploaded acknowledgment for existing installation'});
  }
 }
 return result;
}
// A reused combined DO scan may cover two separate deliveries. Preserve both events.
export const stageFingerprint=(e:StageEvidence)=>createHash('sha256').update(JSON.stringify([e.stage,e.detail,e.files.map(f=>[f.kind,f.siteId??'',f.id]).sort()])).digest('hex');
export function changedStageEvidence(previous:any,next:any){const old=new Set(operationsStageEvidence(previous).map(stageFingerprint));return operationsStageEvidence(next).filter(e=>!old.has(stageFingerprint(e)));}
