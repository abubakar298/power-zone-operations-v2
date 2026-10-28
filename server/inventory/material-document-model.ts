import {Decimal} from 'decimal.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';
import {HttpError} from '../http/errors.js';
import {materialSiteDocuments,reconcileMaterialDispatch} from './material-dispatch.js';

export type MaterialPrintKind='fixed-do'|'variable-do'|'customer-signoff'|'irr';
export type MaterialPrintRow={documentPolicyVersion?:2;itemId:string;description:string;unit:string;issued:string|null;used:string|null;returned:string|null;group?:string;remark?:string;expectedReturn?:string|null;verifiedReturn?:string|null;remainingReturn?:string|null};
export type MaterialPrintModel={kind:MaterialPrintKind;status:'draft'|'simulation'|'issued'|'site-record'|'received';context?:{columns:[string,string,string];rows:[string,string,string][]};title:string;reference:string;warehouse:string;sites:{name:string;ipo:string;orderNumber?:string;customer?:string;customerPo?:string}[];rows:MaterialPrintRow[];note:string;issuedLabel:string;omitIssued?:boolean;customerReturnColumn?:boolean;returnWorksheet?:boolean;signatures:string[];stockPosting:boolean;parentDispatch?:boolean;date?:string;transport?:{issuedTo:string;vehicle:string;driver:string;driverIdentity?:string}};
type Draft={number?:string;id:string;version:number;snapshot:{warehouse:string;parent:boolean;kind:'fixed'|'variable';sites:any[];lines:any[];transport?:{issuedTo:string;vehicle:string;driver:string;driverIdentity?:string}}};
const titles={ 'fixed-do':'Fixed Material Delivery Order','variable-do':'Variable Material Dispatch Order','customer-signoff':'Cable, Pipe and Duct Sign-off',irr:'Installation Reconciliation Report'};
const signatures={ 'fixed-do':['Warehouse issued by','Customer received by'],'variable-do':['Warehouse issued by','Site team received by'],'customer-signoff':['Site engineer','Customer representative'],irr:['Site engineer','Warehouse return verified by']};
const present=(v:unknown)=>typeof v==='string'&&v!==''?v:null;
const draftRows=(draft:Draft,group:string)=>draft.snapshot.lines.filter(r=>r.itemId||r.description||r.out).map((r:any):MaterialPrintRow=>({...{documentPolicyVersion:r.documentPolicyVersion},itemId:r.itemId,description:r.description,unit:r.unit,issued:present(r.out),used:null,returned:null,group}));
const sites=(source:any[])=>source.map(s=>({name:String(s.siteName??s.name??s.id??''),ipo:String(s.ipo??''),orderNumber:s.orderNumber?String(s.orderNumber):undefined,customer:typeof s.customer==='string'?s.customer:undefined,customerPo:typeof s.customerPo==='string'?s.customerPo:undefined}));
function document(kind:MaterialPrintKind,reference:string,warehouse:string,source:any[],rows:MaterialPrintRow[],extra:Partial<MaterialPrintModel>={}):MaterialPrintModel{
 return {kind,status:'draft',title:kind==='customer-signoff'&&rows.some(row=>row.documentPolicyVersion===2)?'Variable-Material Usage Sign-off':titles[kind],reference,warehouse,sites:sites(source),rows,note:'Prepared quantities only. This preview does not issue or credit stock.',issuedLabel:'Planned issue',signatures:signatures[kind],stockPosting:false,...extra};
}

/** Read-only projection of authenticated, saved versions. Neither the request
 * nor a preview can supply usage, mark a receipt verified or claim issuance. */
export function sitePlanPrintModel(plan:{id:string;version:number;variableSupply:string;fixed:Draft;variable:Draft|null},kind:MaterialPrintKind){
 const fixed=plan.fixed,variable=plan.variable,source=fixed.snapshot.sites;
 const reference=`Preparation ${plan.id} / v${plan.version}`;
 const presentation={transport:fixed.snapshot.transport};
 const physicalFixed=draftRows(fixed,'Fixed').filter(r=>!materialDocumentPolicy(r).approvedQuantityLocked);
 const variableRows=variable?draftRows(variable,'Variable'):[];
 if(kind==='fixed-do')return document(kind,reference,fixed.snapshot.warehouse,source,physicalFixed,presentation);
 if(source[0]?.installation===false)throw new HttpError(422,'Delivery-only product sales do not have installation sign-off or reconciliation documents.');
 if(kind==='variable-do'){
  if(plan.variableSupply==='parent-do')throw new HttpError(409,'Variable materials are assigned to a Parent DO. Preview that dispatch instead.');
  return document(kind,reference,fixed.snapshot.warehouse,source,variableRows,presentation);
 }
 const fromParent=plan.variableSupply==='parent-do';
 if(kind==='customer-signoff')return document(kind,reference,fixed.snapshot.warehouse,source,variableRows.filter(r=>materialDocumentPolicy(r).customerUsageSignoff).map(r=>({...r,issued:fromParent?null:r.issued})),{
  omitIssued:fromParent,customerReturnColumn:!fromParent,issuedLabel:fromParent?'Issued at site':'Planned issue',note:fromParent?'Parent DO supply: record the measured quantity issued and used at this site. This site sign-off does not repeat warehouse OUT.':'Customer confirms the variable materials recorded for this site. Used and returned quantities are completed at site.',
 });
 const internal=variableRows.filter(r=>materialDocumentPolicy(r).installationReconciliation).map(r=>({...r,issued:fromParent?null:r.issued,group:'Miscellaneous'}));
 return document(kind,reference,fixed.snapshot.warehouse,source,[...draftRows(fixed,'Fixed'),...internal],{note:'Internal record: fixed items and miscellaneous materials only. Cables, pipes and ducts use their separate customer sign-off. Returns require warehouse receipt verification.'});
}

export function parentDraftPrintModel(draft:Draft,kind:MaterialPrintKind='variable-do',siteId?:string){
 if(!draft.snapshot.parent||draft.snapshot.kind!=='variable')throw new HttpError(422,'Select a variable Parent DO draft.');
 const reference=draft.number??`Parent preparation ${draft.id} / v${draft.version}`;
 if(kind==='variable-do')return document(kind,reference,draft.snapshot.warehouse,draft.snapshot.sites,draftRows(draft,'Variable'),{parentDispatch:true,transport:draft.snapshot.transport,note:'Parent dispatch preparation for the listed sites. Site usage and warehouse returns will reconcile to one warehouse OUT; no stock has been issued by this preview.'});
 if(kind==='fixed-do')throw new HttpError(422,'Fixed materials use their individual site delivery order.');
 const selected=draft.snapshot.sites.find(s=>s.siteId===siteId);
 if(!selected)throw new HttpError(404,'This site does not belong to the Parent DO draft.');
 if(selected.installation===false)throw new HttpError(422,'Delivery-only sales do not have installation variance.');
 const eligible=draft.snapshot.lines.filter(r=>r.sites.includes(siteId)),rows=draftRows({...draft,snapshot:{...draft.snapshot,lines:eligible}},'Miscellaneous').filter(r=>kind==='customer-signoff'?materialDocumentPolicy(r).customerUsageSignoff:materialDocumentPolicy(r).installationReconciliation).map(r=>({...r,issued:null}));
 return document(kind,reference,draft.snapshot.warehouse,[selected],rows,{omitIssued:kind==='customer-signoff',issuedLabel:'Issued at site',note:kind==='customer-signoff'?'Record the variable-material quantities used at this site. This sign-off is linked to the Parent DO; it is not another warehouse dispatch.':'Internal miscellaneous usage for this site. Parent DO unused quantities are reconciled and physically received once at warehouse level.'});
}

/** Safe demonstration of the issued/used document rules. Real issuance will
 * use its committed warehouse record; this helper can never label a simulation
 * as an issued business document. */
export function simulatedMaterialPrintModel(input:unknown,kind:MaterialPrintKind,siteId?:string){
 const result=reconcileMaterialDispatch(input),dispatch=result.dispatch;
 let rows:MaterialPrintRow[],selected=dispatch.sites;
 if(kind==='fixed-do'||kind==='variable-do'){
  if((kind==='fixed-do')!==(dispatch.kind==='fixed'))throw new HttpError(422,'Select the matching warehouse document.');
  rows=dispatch.lines.map(r=>({itemId:r.itemId,description:r.description,unit:r.unit,issued:r.out,used:null,returned:null}));
 }else{
  if(!siteId)throw new HttpError(422,'Select a site for its sign-off.');
  const report=materialSiteDocuments(dispatch,siteId);selected=[report.site];
  if(!report.site.installation)throw new HttpError(422,'Delivery-only sales have no installation reconciliation.');
  const records=kind==='customer-signoff'?report.customerUsage:report.installationReconciliation;
  rows=records.map(r=>({...{documentPolicyVersion:r.documentPolicyVersion},itemId:r.itemId,description:r.description,unit:r.unit,issued:r.issuedAtSite,used:r.used,returned:kind==='irr'?r.returnedAtSite:null,remark:r.used===null?'Usage not recorded':''}));
 }
 return document(kind,dispatch.reference,dispatch.warehouse,selected,rows,{status:'simulation',issuedLabel:dispatch.parent&&siteId?'Issued at site':'Issued',note:kind==='customer-signoff'?'Measured usage confirmation. Warehouse return quantities belong on the internal warehouse receipt, not the customer sign-off.':kind==='irr'?'Internal site usage record. A Parent DO return is reconciled and verified at warehouse level; it is not inferred separately for each site.':'Simulation only. The original dispatch and separately evidenced top-ups are distinct warehouse records.'});
}

/** Only committed repository dispatch records reach this projection. No caller
 * quantities, current draft edits or inferred usage can alter the issued copy. */
export function issuedDispatchPrintModel(record:{id:string;number:string;created_at:Date|string;snapshot:Draft['snapshot']&{status:string;stockPosting:boolean;requiresSignedGate?:boolean;transport?:{issuedTo:string;vehicle:string;driver:string}}}):MaterialPrintModel{
 const s=record.snapshot;
 if(s.status!=='issued'||s.stockPosting!==true&&!s.requiresSignedGate)throw new HttpError(409,'Only a committed warehouse dispatch has an issued document.');
 const kind=s.kind==='fixed'?'fixed-do':'variable-do',transport=s.transport;
 return document(kind,record.number,s.warehouse,s.sites,draftRows({id:record.id,version:1,snapshot:s},s.kind==='fixed'?'Fixed':'Variable'),{parentDispatch:s.parent,status:s.stockPosting?'issued':'draft',stockPosting:s.stockPosting,date:new Date(record.created_at).toISOString().slice(0,10),transport,issuedLabel:'Issued',note:!s.stockPosting?'Awaiting signed gate copy. Document creation and printing do not post warehouse OUT.':`Warehouse OUT recorded once on ${new Date(record.created_at).toISOString().slice(0,10)}. Custody received by: ${transport?.issuedTo||'Not recorded'}. Vehicle: ${transport?.vehicle||'Not recorded'}. Driver: ${transport?.driver||'Not recorded'}. This copy does not create another stock movement. Site usage and counted warehouse returns are recorded separately.`});
}

/** Site sign-off/internal report from immutable measured-use versions. Uploaded
 * signatures remain separate evidence; this generated copy is not a gate IN. */
export function siteUsagePrintModel(data:{draft:any;source:any;documents:any;report:any;references?:string[]},kind:'customer-signoff'|'irr'):MaterialPrintModel{
 if(data.source.installation!==true)throw new HttpError(422,'Delivery-only sales have no installation usage record.');
 if(!data.report)throw new HttpError(409,'Save the measured site use before previewing this record.');
 const records=kind==='customer-signoff'?data.documents.customerUsage:data.documents.installationReconciliation;
 const rows=records.map((r:any)=>({...{documentPolicyVersion:r.documentPolicyVersion},itemId:r.itemId,description:r.description,unit:r.unit,issued:r.issuedAtSite,used:r.used,returned:kind==='irr'?r.returnedAtSite:null,remark:r.remark,group:data.draft.snapshot.kind==='fixed'?'Fixed':'Miscellaneous'}));
 const references=data.references??[];
 return document(kind,`${references[0]??'Approved work basis'} / Site use v${data.report.version}${references.length>1?' / +'+(references.length-1)+' dispatches':''}`,data.draft.snapshot.warehouse,[data.source],rows,{status:'site-record',stockPosting:false,...(kind==='customer-signoff'?{omitIssued:!!data.draft.snapshot.parent,customerReturnColumn:!data.draft.snapshot.parent}:{}),...(kind==='irr'&&records.length>0&&records.every((r:any)=>materialDocumentPolicy(r).approvedQuantityLocked)?{signatures:['Site engineer','QC verification']}:{}),issuedLabel:data.draft.snapshot.parent?'Issued at site':'Issued',note:`${references.length?'Linked dispatches: '+references.join(', ')+'.':'Approved BOQ work; no warehouse dispatch.'} Site use recorded for ${data.report.snapshot.date}. ${data.report.snapshot.state==='signed'?'Sign-off evidence attached. The original uploaded document retains the signatures.':'Signed evidence pending.'} This report does not post warehouse OUT or verify a warehouse return.`});
}

export function purchaseReceiptPrintModel(record:{id:string;number:string;warehouse:string;created_at:Date|string;snapshot:any}):MaterialPrintModel{
 const s=record.snapshot;if(s.stockPosting!==true||!Array.isArray(s.lines))throw new HttpError(409,'Only a committed warehouse receipt has an incoming goods pass.');
 return {kind:'fixed-do',status:'received',title:'Incoming Goods Pass',reference:record.number,warehouse:record.warehouse,sites:[],context:{columns:['Purchase request','Warehouse receipt','Receipt date'],rows:[[s.purchaseRequest.number,record.number,new Date(record.created_at).toISOString().slice(0,10)]]},rows:s.lines.map((r:any)=>({itemId:r.itemId,description:r.description??r.itemId,unit:r.unit,issued:r.quantity,used:null,returned:null})),issuedLabel:'Received',stockPosting:true,signatures:['Received by storekeeper','Verified by Inventory'],note:'Physical purchase receipt recorded once. Reprinting this pass does not create another warehouse IN. Purchase prices are not included.'};
}

/** Counted warehouse return, kept separate from customer site sign-off. */
export function returnReceiptPrintModel(record:{id:string;number:string;warehouse:string;created_at:Date|string;snapshot:any}):MaterialPrintModel{
 const s=record.snapshot;if(!Array.isArray(s.lines)||!s.evidence?.id)throw new HttpError(409,'Only a committed counted return has an incoming goods pass.');
 const lines=new Map<string,{itemId:string;unit:string;quantity:Decimal}>();
 for(const r of s.lines){const key=r.itemId+'|'+r.unit,prior=lines.get(key);lines.set(key,{itemId:r.itemId,unit:r.unit,quantity:(prior?.quantity??new Decimal(0)).plus(r.quantity)});}
 return {kind:'fixed-do',status:'received',title:'Incoming Goods Pass',reference:record.number,warehouse:record.warehouse,sites:[],context:{columns:['Return reference','Receipt date','Warehouse'],rows:[[record.number,new Date(record.created_at).toISOString().slice(0,10),record.warehouse]]},rows:[...lines.values()].map(r=>({itemId:r.itemId,description:'Verified physical return',unit:r.unit,issued:r.quantity.toString(),used:null,returned:null})),issuedLabel:'Received',stockPosting:true,signatures:['Received by storekeeper','Verified by Inventory'],note:'Counted return already credited once against the original dispatch. Reprinting or uploading a signed copy does not change stock.'};
}

/** Read-only count sheet from committed dispatch and signed site-use records.
 * Previously verified IN remains explicit; actual receipt cells stay blank. */
export function returnWorksheetPrintModel(data:any):MaterialPrintModel{
 const source=data.draft.snapshot;
 const rows=(data.reconciliation?.rows??[]).map((row:any)=>({itemId:row.itemId,description:row.description,unit:row.unit,issued:row.warehouseOut,used:row.used,returned:null,expectedReturn:row.expectedReturn,verifiedReturn:row.verifiedWarehouseReturn,remainingReturn:row.remaining}));
 return {kind:'variable-do',status:'draft',title:'Return IGP · Warehouse Count Sheet',reference:`Return worksheet / ${data.references?.join(' / ')||data.draft.id} / v${data.draft.version}`,warehouse:source.warehouse,sites:sites(source.sites),rows,returnWorksheet:true,stockPosting:false,issuedLabel:'Parent DO OUT',signatures:['Returned by / site custodian','Warehouse counted, signed and stamped by'],note:'Fill Actual return with quantities physically counted on this trip. Previously verified warehouse IN is shown separately. Partial returns are allowed. Upload the signed and stamped sheet for verification; printing this sheet does not credit stock. Blank use or expected figures remain pending, not zero.'};
}
