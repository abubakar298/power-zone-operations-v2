import {upsBatchProgress} from './ups-progress.js';
const text=(v:unknown)=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
const configuration=(v:unknown)=>String(v??'').replace(/^0-/,'');
export function systemInvoiceReferences(row:any,excluded:Iterable<string>=[]){const omitted=new Set([...excluded].map(text));return Array.isArray(row.invoiceReferences)?[...new Set<string>(row.invoiceReferences.filter((v:any)=>typeof v==='string'&&v.trim()).map((v:string)=>v.trim()))].filter(v=>!omitted.has(text(v))):[];}
const total=(r:any)=>Number(String(r.orderNumber??'').split('/')[1])||Number(String(r.program??'').match(/\d+/)?.[0])||0;
/** Atif IPO order positions and Accounts invoice positions are different identities.
 * Source cross-references, never equal ordinal numbers, attach legacy financial history.
 * All original programme versions remain available in their existing audit APIs.
 */
export function canonicalUpsRegister(customer:'UBL'|'MBL',input:any[],programRows:any[],issued:any[],available:string[]=[],now=new Date(),sourceAsOf?:string,excludedInvoiceReferences:string[]=[]){
 const all=input.filter(r=>r.kind==='UPS'&&String(r.key??'').split(':')[0]===customer),source=all.filter(r=>r.cancelled!==true&&r.transferred!==true);
 const programs=programRows.filter(p=>p.snapshot.managementRegister).map(p=>({...p.snapshot.managementRegister,programKey:p.program_key,version:p.version}));
 const entries=programs.flatMap(p=>p.sites.map((s:any)=>({program:p,site:s,legacyId:`${p.programKey}:${s.orderNumber||s.legacyJobId}`,completion:p.completionApprovals?.[s.orderNumber],operationalCompletion:p.completionConfirmations?.[s.orderNumber],installationAlert:p.installationAlerts?.[s.orderNumber]})));
 const assigned=new Map<string,any[]>(),unmapped:any[]=[],reviews:any[]=[];
 const invoiceSites=new Map<string,Set<string>>();
 for(const r of source)for(const ref of systemInvoiceReferences(r,excludedInvoiceReferences)){const key=text(ref);invoiceSites.set(key,new Set([...(invoiceSites.get(key)??[]),r.key]));}
 for(const entry of entries){
  const p=entry.program,s=entry.site;
  const compatible=source.filter(r=>configuration(r.configuration)===p.configuration),scoped=compatible.filter(r=>total(r)===p.totalSites);
  let candidates=s.invoiceReference?compatible.filter(r=>(r.invoiceReferences??[]).some((v:any)=>text(v)===text(s.invoiceReference))):[];
  if(!candidates.length&&s.orderNumber)candidates=compatible.filter(r=>(r.accountsReferences??[]).includes(s.orderNumber));
  if(!candidates.length&&text(s.siteName))candidates=scoped.filter(r=>text(r.site)===text(s.siteName));
  if(candidates.length!==1){unmapped.push({id:entry.legacyId,accountingReference:s.orderNumber,invoiceReference:s.invoiceReference,site:s.siteName,hasApprovedCompletion:!!entry.completion,reason:candidates.length?'Ambiguous source cross-reference':'No verified source cross-reference'});continue;}
  const key=candidates[0].key;assigned.set(key,[...(assigned.get(key)??[]),entry]);
 }
 const matched=new Set<string>();
 const rows=source.map(r=>{
  const bindings=assigned.get(r.key)??[],financial=bindings.filter(v=>v.completion),single=bindings.length===1?bindings[0]:null;
  // A verified source link is stronger than a display name or shared batch number.
  let ipos=issued.filter(i=>i.sourceKey===r.key);
  if(!ipos.length)ipos=issued.filter(i=>!i.sourceKey&&i.number===r.ipo&&i.orderNumber===r.orderNumber&&text(i.poReference)&&text(i.poReference)===text(r.po)&&text(i.site)===text(r.site));
  const ipo=ipos.length===1?ipos[0]:null;if(ipo)matched.add(ipo.id);
  if(ipos.length>1)reviews.push({sourceKey:r.key,reason:'Multiple issued IPOs claim this canonical source identity.'});
  if(financial.length>1)reviews.push({sourceKey:r.key,reason:'Multiple approved financial closures require reconciliation; neither is summed twice.'});
  const completion=r.installed===true&&financial.length===1?financial[0].completion:undefined;
  if(financial.length&&r.installed!==true)reviews.push({sourceKey:r.key,reason:'Prior financial closure and latest installation position differ; original approval is retained in history.'});
  const invoices=(r.invoiceReferences??[]).map(String),legacyStatus=single?.site.recoveryStatus;
  const systemReferences=systemInvoiceReferences(r,excludedInvoiceReferences).filter(ref=>invoiceSites.get(text(ref))?.size===1);
  const submitted=r.installed===true&&r.singleInvoiceSubmitted===true&&systemReferences.length>0;
  if(r.singleInvoiceSubmitted===true&&!systemReferences.length)reviews.push({sourceKey:r.key,reason:'System invoice submission has no unique reviewed system invoice reference.'});
  const status={...legacyStatus,deliveryStatus:r.delivered===true?'Delivered':'Not delivered',installationStatus:r.installed===true?'Completed':'Pending',deliveryDate:r.deliveryDate??null,paymentStatus:r.singlePaymentReceived===true?'Received':r.singlePaymentReceived===false?'Pending':'Unverified',systemPaymentStatus:r.singlePaymentReceived===true?'Received':r.singlePaymentReceived===false?'Pending':'Unverified',invoiceStatus:submitted?'Submitted':'Not submitted',canonicalSubmissionEvidence:submitted?{verified:true,source:'Reviewed Accounts source register',invoiceReferences:systemReferences}:undefined,systemInvoices:(legacyStatus?.systemInvoices??[]).filter((v:any)=>invoices.some((i:string)=>text(i)===text(v.invoice))&&(r.installed===true||v.paymentReceived===true))};
  return {id:r.key,source:'Reviewed source register',sourceKey:r.key,status:completion?'Approved closed':r.installed?'Completed':r.delivered?'Delivered — installation pending':'Awaiting delivery',projectReference:r.ipo,number:r.ipo,orderNumber:r.orderNumber,configuration:configuration(r.configuration),site:r.site,siteCode:r.siteCode,siteNameStatus:'Source identified',ipoId:ipo?.id??null,invoiceReference:invoices.length===1?invoices[0]:'',invoiceReferences:invoices,accountsReferences:[...(r.accountsReferences??[])],invoiceStatus:submitted?'Invoiced':'Not invoiced',invoiceDate:single?.site.invoiceDate??'',completion,operationalCompletion:r.installed?{completionDate:r.installationDate,source:'Reviewed Accounts source register'}:undefined,installationAlert:single?.installationAlert,recoveryStatus:status,sourceFilename:r.sourceFilename??'',sourceRow:r.sourceRow??single?.site.sourceRow??null,legacyJobId:single?.site.legacyJobId??'',nameEvidence:single?.site.nameEvidence??[],partialDelivery:r.partialDelivery===true,sourceFlags:[...(r.flags??[])],mappingStatus:r.mappingStatus??'',legacyHistory:bindings.map(v=>({id:v.legacyId,programKey:v.program.programKey,accountingReference:v.site.orderNumber,invoiceReference:v.site.invoiceReference,site:v.site.siteName,completion:v.completion,operationalCompletion:v.operationalCompletion})),costingStatus:completion?.actualCost!=null?'Recorded in Actual from approved costing':financial.length>1?'Closure identity review required':'Not supplied',programTotal:total(r)};
 });
 const unmatchedIssued=issued.filter(r=>!matched.has(r.id));
 for(const item of unmatchedIssued){
  const possible=all.some(r=>r.ipo===item.number&&r.orderNumber===item.orderNumber||text(r.po)&&text(r.po)===text(item.poReference))||!!item.sourceKey;
  if(possible){reviews.push({ipoId:item.id,orderNumber:item.orderNumber,reason:'Issued document is retained but its canonical source identity needs review.'});continue;}
  // New ordinary sales after the source cutoff stay visible; historical imports
  // require a verified canonical link and cannot become duplicate active sites.
  if(item.historicalImport){reviews.push({ipoId:item.id,reason:'Historical import has no canonical source match.'});continue;}
  const cutoff=sourceAsOf?Date.parse(sourceAsOf+'T23:59:59.999+05:00'):NaN,issuedAt=new Date(item.issuedAt).getTime();
  if(Number.isFinite(cutoff)&&(!Number.isFinite(issuedAt)||issuedAt<=cutoff)){reviews.push({ipoId:item.id,orderNumber:item.orderNumber,reason:'This earlier issued document needs source identity review; it is not a new sale after the register cutoff.'});continue;}
  rows.push({id:item.id,source:'Confirmed sale',sourceKey:'',status:'Active',projectReference:item.number,number:item.number,orderNumber:item.orderNumber,configuration:item.configuration,site:item.site,siteCode:item.siteCode,siteNameStatus:'Source identified',ipoId:item.id,invoiceReference:'',invoiceReferences:[],accountsReferences:[],invoiceStatus:'Not entered',invoiceDate:'',completion:undefined,operationalCompletion:undefined,installationAlert:undefined,recoveryStatus:{deliveryStatus:'Unverified',installationStatus:'Unverified',deliveryDate:null,paymentStatus:'Unverified',systemPaymentStatus:'Unverified',invoiceStatus:'Unverified',systemInvoices:[]},sourceFilename:'',sourceRow:null,legacyJobId:'',nameEvidence:[],partialDelivery:false,sourceFlags:[],mappingStatus:'',legacyHistory:[],costingStatus:'Not supplied',programTotal:total(item)});
 }
 const keys=[...new Set(rows.map(r=>`${r.projectReference}:${r.configuration}:${r.programTotal}`))];
 const outputPrograms=keys.map(key=>{
  const members=rows.filter(r=>`${r.projectReference}:${r.configuration}:${r.programTotal}`===key),first=members[0],original=programs.find(p=>p.projectReference===first.projectReference&&p.configuration===first.configuration&&p.totalSites===first.programTotal),count=first.programTotal;
  const projected={customer,projectReference:first.projectReference,totalSites:count,sites:members.map(r=>({orderNumber:r.orderNumber,siteName:r.site,ipoSharedAt:issued.find(i=>i.id===r.ipoId)?.issuedAt,recoveryStatus:r.recoveryStatus})),completionConfirmations:Object.fromEntries(members.filter(r=>r.operationalCompletion).map(r=>[r.orderNumber,r.operationalCompletion])),completionApprovals:Object.fromEntries(members.filter(r=>r.completion).map(r=>[r.orderNumber,r.completion])),installationAlerts:Object.fromEntries(members.filter(r=>r.installationAlert).map(r=>[r.orderNumber,r.installationAlert])),progressEvidenceSource:original?.progressEvidenceSource};
  return {programKey:`CANONICAL:${customer}:${key}`,projectReference:first.projectReference,configuration:first.configuration,totalSites:count,listedSites:members.length,activeSites:members.length,remainingSites:Math.max(0,count-members.length),invoicedSites:members.filter(r=>r.invoiceStatus==='Invoiced').length,reconciliationReview:[],progressSummary:upsBatchProgress(projected,now)};
 });
 const configurations=[...new Set([...available,...rows.map(r=>r.configuration)])].sort().map(configuration=>({configuration,activeSites:rows.filter(r=>r.configuration===configuration).length}));
 return {source:'Reviewed source register',bankReconciliation:programs.find(p=>p.bankReconciliation)?.bankReconciliation??null,rows,programs:outputPrograms,configurations,activeSites:rows.length,importedSites:rows.filter(r=>!r.ipoId).length,totalOrdered:outputPrograms.reduce((n,p)=>n+p.totalSites,0),remainingSites:outputPrograms.reduce((n,p)=>n+p.remainingSites,0),cancelled:all.filter(r=>r.cancelled===true),transferred:all.filter(r=>r.transferred===true),identityReview:reviews,legacyReconciliationReview:programs.flatMap(p=>p.reconciliationReview??[]),unmappedLegacyHistory:unmapped};
}
