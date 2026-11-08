import {z} from 'zod';
import {completionEvidence} from '../../shared/qc-completion-evidence.js';
type Row=Record<string,any>;
type FileRef={id:string;name:string;mediaType:string};
const uuid=z.uuid();
const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/heic','image/heif']);
const stageNames:Record<string,string>={civil:'Civil works',electrical:'Electrical works',testing:'Testing & commissioning',signoff:'Customer sign-off',cabinet:'Cabinet installation',panel:'Panel installation',bessTesting:'BESS testing',handover:'Handover',job:'UPS installation'};
const ref=(f:any):FileRef|null=>uuid.safeParse(f?.id).success?{id:f.id,name:String(f.name??'Uploaded file'),mediaType:String(f.mediaType??'')}:null;
const qcEntries=(s:Row)=>[...Object.entries(s.qc??{}).map(([stage,entry])=>({stage,entry:entry as Row})),...s.qcJob?[{stage:'job',entry:s.qcJob as Row}]:[]].filter(e=>e.entry&&typeof e.entry==='object');

/** Existing QC uploads for one site, grouped for Accounts. No new upload is needed. */
export function projectSiteEvidence(siteId:string,s:Row){
 const signedDos:Row[]=[],vso:Row[]=[],acknowledgments:Row[]=[],pictureGroups:Row[]=[];
 const seen=new Set<string>();
 const push=(list:Row[],file:FileRef|null,extra:Row)=>{if(!file||seen.has(list===signedDos?'do:'+file.id:file.id))return;seen.add(list===signedDos?'do:'+file.id:file.id);list.push({...file,...extra});};
 (s.deliveries??[]).forEach((d:Row,i:number)=>push(signedDos,ref(d.signedDo),{date:d.deliveryDate??null,label:`${d.partial?'Partial delivery':'Delivery'} ${i+1}`}));
 for(const d of s.documents??[]){
  if(d.id===`${siteId}:historical-delivery-documents`){
   push(signedDos,ref(d.evidence?.[0]),{date:d.date??null,label:'Signed delivery DO'});
   const photo=ref(d.evidence?.[1]);
   if(photo)pictureGroups.push({key:d.id,stage:'Historical delivery',kind:'delivery',date:d.date??null,files:[photo]});
  }else if(/DO\b/.test(String(d.label??''))&&!(s.deliveries??[]).some((x:Row)=>x.documentId===d.id)){
   for(const f of d.evidence??[])push(signedDos,ref(f),{date:d.date??null,label:String(d.label)});
  }
  if(d.id===`${siteId}:completion-documents`||d.id===`${siteId}:historical-handover-documents`){const c=completionEvidence(d);push(acknowledgments,ref(c.acknowledgement),{date:d.date??null,label:'Customer acknowledgment'});push(vso,ref(c.variableSignoff),{date:d.date??null,label:'Variable items sign-off (VSO)'});}
 }
 for(const {entry} of qcEntries(s)){push(acknowledgments,ref(entry.acknowledgement),{date:entry.date??null,label:'Customer acknowledgment'});push(vso,ref(entry.variableSignoff),{date:entry.date??null,label:'Variable items sign-off (VSO)'});}
 // Pictures by delivery, then by QC installation stage.
 (s.deliveries??[]).forEach((d:Row,i:number)=>{const f=ref(d.materialPhoto);if(f)pictureGroups.push({key:`delivery-${i+1}`,stage:`${d.partial?'Partial delivery':'Delivery'} ${i+1}`,kind:'delivery',date:d.deliveryDate??null,files:[f]});});
 const signatureIds=new Set([...signedDos,...vso,...acknowledgments].map(f=>f.id));
 for(const {stage,entry} of qcEntries(s)){
  const files=[entry.evidence,...entry.additionalEvidence??[],...Object.values(entry.stagePictures??{}).flat()].map(ref).filter((f):f is FileRef=>!!f&&!signatureIds.has(f.id)&&(imageTypes.has(f.mediaType)||!f.mediaType));
  const unique=files.filter((f,i,all)=>all.findIndex(o=>o.id===f.id)===i);
  if(unique.length)pictureGroups.push({key:'qc-'+stage,stage:stageNames[stage]??stage,kind:'installation',date:entry.date??null,files:unique});
 }
 const historical=s.documents?.find((d:Row)=>d.id===`${siteId}:historical-handover-documents`);
 const historicalPhotos=(historical?.photographs??[]).map(ref).filter((f:FileRef|null):f is FileRef=>!!f&&!signatureIds.has(f.id));
 if(historicalPhotos.length)pictureGroups.push({key:'historical-installation',stage:'Historical installation',kind:'installation',date:historical?.date??null,files:historicalPhotos});
 // Historical or untyped document batches stay visible rather than disappearing.
 const shown=new Set([...signedDos,...vso,...acknowledgments,...pictureGroups.flatMap(g=>g.files)].map((f:Row)=>f.id)),otherDocuments:Row[]=[];
 for(const d of s.documents??[])for(const f of (d.evidence??[]).map(ref))if(f&&!shown.has(f.id)){shown.add(f.id);otherDocuments.push({...f,date:d.date??null,label:String(d.label??'Site document')});}
 const final=s.qcJob??s.qc?.handover??s.qc?.signoff??completionEvidence(historical);
 const vsoNotRequired=final?.noVariableItemsUsed===true||(s.documents??[]).some((d:Row)=>d.id===`${siteId}:completion-documents`&&completionEvidence(d).noVariableItemsUsed);
 return {signedDos,vso,acknowledgments,pictureGroups,otherDocuments,vsoNotRequired};
}
export function evidenceFileIds(siteId:string,s:Row){
 const e=projectSiteEvidence(siteId,s);
 return new Set([...e.signedDos,...e.vso,...e.acknowledgments,...e.pictureGroups.flatMap((g:Row)=>g.files),...e.otherDocuments].map((f:Row)=>f.id));
}
