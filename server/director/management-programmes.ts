import {latestProgrammeHandoffs,applyProgrammeHandoffs} from './programme-handoffs.js';
import {Decimal} from 'decimal.js';
import type {Pool} from 'pg';
import {HttpError} from '../http/errors.js';
import {canonicalUpsRegister,systemInvoiceReferences} from './ups-canonical-register.js';
import {ipoSiteIdentity} from '../orders/site-identity.js';
import outcomeEvidence from './management-programme-outcomes-v1.json' with {type:'json'};

type SourceRow=Record<string,any>;
export type ProgrammeMetric={sites:number;siteKeys:string[];amount:string|null;knownSites:number;missingSites:number;receivedSites:number;receivedAmount:string|null};
export type ProgrammeRow={key:string;sourceKey:string;recordKey:string|null;customer:'UBL'|'MBL';program:string;ipo:string;orderNumber:string;site:string;siteCode:string;po:string;configuration:string;active:boolean;cancelled:boolean;transferred:boolean;delivered:boolean;partialDelivery:boolean;scheduled?:boolean;installationRequired?:boolean;installed:boolean;deliveryDate:string|null;installationDate:string|null;invoiceSubmitted:boolean;paymentReceived:boolean|null;invoiceReferences:string[];accountsReferences:string[];grossContract:string|null;remainingPayable:string|null;advanceReceived:string|null;flags:string[];mappingStatus:string;sources:SourceRow[];cancellationOutcome:string|null};
export type ProgrammeMilestone={submitted:ProgrammeMetric;received:ProgrammeMetric;pending:ProgrammeMetric;toSubmit:ProgrammeMetric;future:ProgrammeMetric};
export type ManagementProgramme={key:string;label:string;capacity:number;rows:ProgrammeRow[];cancelled:ProgrammeRow[];transferred:ProgrammeRow[];summary:Record<'active'|'installed'|'pendingDelivery'|'partialDelivery'|'installationPending'|'invoicePending'|'paymentPending'|'advanceReceived',ProgrammeMetric>;milestones?:{advance:ProgrammeMilestone;completion:ProgrammeMilestone}};
export type ManagementProgrammes={sourceDate:string;sourceVersion:number;readOnly:true;operationsAsOf?:string;programmes:ManagementProgramme[];issues:string[]};
const money=(value:unknown):string|null=>{if(value===null||value===undefined||value==='')return null;try{const n=new Decimal(String(value));return n.isFinite()&&n.gte(0)?n.toFixed(2):null;}catch{return null;}};
const fraction=(value:unknown,fallback:string)=>{try{const n=new Decimal(value==null?fallback:String(value));return n.isFinite()&&n.gte(0)&&n.lte(1)?n:null;}catch{return null;}};
const refs=(value:unknown):string[]=>Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))]:[];
const invoiceKey=(v:unknown)=>String(v??'').trim().toLowerCase();
function cancellationEvidence(row:SourceRow):{outcome:string|null;sources:SourceRow[];flags:string[]}{
 if(row.cancelled!==true&&row.transferred!==true)return{outcome:null,sources:[],flags:[]};
 for(const field of ['cancellationOutcome','transferOutcome','outcome'])if(typeof row[field]==='string'&&row[field].trim())return{outcome:row[field],sources:[],flags:[]};
 const replacement=row.replacement;
 if(typeof replacement?.verified==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(replacement.verified)&&typeof replacement.replacementOrder==='string'&&replacement.replacementOrder.trim()&&typeof replacement.replacementPo==='string'&&replacement.replacementPo.trim())return{outcome:`Reissued as active order ${replacement.replacementOrder} · PO ${replacement.replacementPo}.`,sources:[{name:'Verified replacement in reviewed source',verified:replacement.verified,sourceRows:replacement.sourceRows??[]}],flags:[]};
 if(typeof row.cancellationReason==='string'&&row.cancellationReason.trim())return{outcome:row.cancellationReason,sources:[],flags:[]};
 const entry=outcomeEvidence.entries.find(e=>e.sourceKey===row.key);
 if(!entry)return{outcome:'Outcome not recorded in reviewed source.',sources:[],flags:[]};
 if(!entry.expectedOriginalPo||typeof row.po!=='string'||row.po!==entry.expectedOriginalPo)return{outcome:'Outcome held: original PO does not match the reviewed cancellation evidence.',sources:[],flags:['Cancellation outcome requires review: original PO is missing or differs from frozen evidence.']};
 return{outcome:entry.outcome,sources:[{name:outcomeEvidence.sourceName,sourceFile:outcomeEvidence.sourceFile,sourceDate:outcomeEvidence.sourceDate,sourceSha256:outcomeEvidence.sourceSha256,identitySourceSha256:outcomeEvidence.identitySourceSha256,frozenHandoff:outcomeEvidence.frozenHandoff,sourceKey:entry.sourceKey,originalPo:entry.expectedOriginalPo}],flags:[]};
}

const sum=(values:(string|null)[])=>values.every(v=>v!==null)?values.reduce((n,v)=>n.add(v!),new Decimal(0)).toFixed(2):null;
function metric(rows:ProgrammeRow[],value:(row:ProgrammeRow)=>string|null,received?: (row:ProgrammeRow)=>string|null):ProgrammeMetric{
 const amounts=rows.map(value),known=amounts.filter((v):v is string=>v!==null),paidRows=received?rows.filter(r=>r.paymentReceived===true):[],paid=paidRows.map(r=>received!(r));
 return{sites:rows.length,siteKeys:rows.map(r=>r.key),amount:rows.length===0?'0.00':known.length?known.reduce((n,v)=>n.add(v),new Decimal(0)).toFixed(2):null,knownSites:known.length,missingSites:rows.length-known.length,receivedSites:paidRows.length,receivedAmount:sum(paid)};
}
/** Pure reporting projection. Source booleans remain authoritative; no receipt, IPO or journal is created. */
export function projectManagementProgrammes(snapshot:SourceRow,sourceDate:string,sourceVersion:number):ManagementProgrammes{
 const inputs=(snapshot.registers??[]).flatMap((r:SourceRow)=>r.rows??[]),excluded=[...(snapshot.cables?.rows??[]),...(snapshot.internet?.rows??[])].map((r:SourceRow)=>r.invoice),issues:string[]=[],seen=new Set<string>();
 const sourceByKey=new Map<string,SourceRow>();
 const invoiceSites=new Map<string,Set<string>>();
 for(const row of inputs.filter((r:SourceRow)=>r.kind==='UPS'&&!r.cancelled&&!r.transferred))for(const ref of systemInvoiceReferences(row,excluded)){const bank=row.customer==='MBL'||String(row.key??'').startsWith('MBL:')?'MBL':'UBL',id=bank+':'+invoiceKey(ref);invoiceSites.set(id,new Set([...(invoiceSites.get(id)??[]),String(row.key??'')]));}
 const normalized:ProgrammeRow[]=[];
 for(const r of inputs){
  const customer=r.customer==='MBL'||String(r.key??'').startsWith('MBL:')?'MBL':'UBL';
  if(!(r.kind==='UPS'||customer==='UBL'&&r.program==='Solar 70'))continue;
  const key=String(r.key??'');if(!key||seen.has(key))throw new HttpError(422,'The reviewed programme source contains a missing or duplicated site identity.');seen.add(key);sourceByKey.set(key,r);
  const ups=r.kind==='UPS',gross=money(r.grossContract),remaining=fraction(r.remainingFraction,customer==='UBL'?'0.5':'1'),advance=fraction(r.advanceReceivedFraction,customer==='UBL'?'0.5':'0');
  const entitlement=ups?gross!==null&&remaining?new Decimal(gross).mul(remaining).toFixed(2):null:null;
  const payment=ups?(typeof r.singlePaymentReceived==='boolean'?r.singlePaymentReceived:null):null;
  const outstanding=ups?payment===true?'0.00':payment===false?entitlement:null:sum(['advance','completion'].map(stage=>{const s=r[stage];return s?.received===true||s?.cashReceived===true?'0.00':money(s?.outstandingAmount??s?.invoiceAmount??s?.expected);}));
  const cancellation=cancellationEvidence(r);
  const invoices=refs(r.invoiceReferences),system=systemInvoiceReferences(r,excluded).filter(ref=>!ups||invoiceSites.get(customer+':'+invoiceKey(ref))?.size===1),installed=r.installed===true;
  const row:ProgrammeRow={key,sourceKey:key,recordKey:typeof r.recordKey==='string'?r.recordKey:typeof r.registeredSiteId==='string'?r.registeredSiteId:null,customer,program:String(r.program??''),ipo:String(r.ipo??''),orderNumber:String(r.orderNumber??''),site:String(r.site??''),siteCode:String(r.siteCode??''),po:String(r.po??''),configuration:String(r.configuration??''),active:r.cancelled!==true&&r.transferred!==true,cancelled:r.cancelled===true,transferred:r.transferred===true,delivered:r.delivered===true,partialDelivery:r.partialDelivery===true,scheduled:r.scheduled===true,installationRequired:typeof r.installationRequired==='boolean'?r.installationRequired:undefined,installed,deliveryDate:r.deliveryDate??null,installationDate:r.installationDate??null,invoiceSubmitted:ups?(installed||r.installationRequired===false&&r.delivered===true)&&r.singleInvoiceSubmitted===true&&system.length>0:installed&&r.completion?.submitted===true,paymentReceived:payment,invoiceReferences:invoices,accountsReferences:refs(r.accountsReferences),grossContract:gross,remainingPayable:outstanding,advanceReceived:ups?r.receiptsUnverified===true?null:gross!==null&&advance?new Decimal(gross).mul(advance).toFixed(2):null:money(r.advance?.receivedAmount??(r.advance?.received===true||r.advance?.cashReceived===true?r.advance?.invoiceAmount:null)),flags:[...refs(r.flags),...cancellation.flags],mappingStatus:String(r.mappingStatus??''),sources:[...(Array.isArray(r.sources)?r.sources:[]),...cancellation.sources],cancellationOutcome:cancellation.outcome};
  if(ups&&r.singleInvoiceSubmitted===true&&system.length===0)row.flags.push('System invoice submission has no unambiguous system invoice reference.');
  if(ups&&payment===null)row.flags.push('System payment status is unverified; outstanding value is held.');
  normalized.push(row);
 }
 const specs=[['ubl-solar-70','UBL Solar 70',70,(r:ProgrammeRow)=>r.customer==='UBL'&&r.program==='Solar 70'],['ubl-ups-250','UBL UPS 250',250,(r:ProgrammeRow)=>r.customer==='UBL'&&r.program==='UPS 250'],['mbl-ups-80','MBL UPS 80',80,(r:ProgrammeRow)=>r.customer==='MBL'&&r.program==='MBL UPS 80'],['mbl-ups-20','MBL UPS 20',20,(r:ProgrammeRow)=>r.customer==='MBL'&&r.program==='MBL UPS 20'],['mbl-ups-60','MBL UPS 60',60,(r:ProgrammeRow)=>r.customer==='MBL'&&r.program==='MBL UPS 60'],['all-ups','Combined all UPS',410,(r:ProgrammeRow)=>sourceByKey.get(r.key)?.kind==='UPS']] as const;
 const programmes:ManagementProgramme[]=specs.map(([key,label,capacity,accept])=>{
  const scoped=normalized.filter(accept),rows=scoped.filter(r=>r.active),ups=key!=='ubl-solar-70';
  const due=(r:ProgrammeRow)=>r.remainingPayable;
  const entitlement=(r:ProgrammeRow)=>{const f=fraction(sourceByKey.get(r.key)?.remainingFraction,r.customer==='UBL'?'0.5':'1');return r.grossContract===null||!f?null:new Decimal(r.grossContract).mul(f).toFixed(2);};
  const paid=(r:ProgrammeRow)=>r.paymentReceived===true?entitlement(r):null;
  const summary={active:metric(rows,r=>r.grossContract),installed:metric(rows.filter(r=>r.installed),ups?entitlement:due,paid),pendingDelivery:metric(rows.filter(r=>!r.delivered),due,paid),partialDelivery:metric(rows.filter(r=>r.partialDelivery&&!r.delivered),due,paid),installationPending:metric(rows.filter(r=>(r.delivered||r.partialDelivery)&&!r.installed&&r.installationRequired!==false),due,paid),invoicePending:metric(rows.filter(r=>(r.installed||r.installationRequired===false&&r.delivered)&&!r.invoiceSubmitted),ups?due:r=>{const s=sourceByKey.get(r.key)?.completion;return s?.received||s?.cashReceived?'0.00':money(s?.outstandingAmount??s?.invoiceAmount??s?.expected);},paid),paymentPending:metric(rows.filter(r=>ups?(r.installed||r.installationRequired===false&&r.delivered)&&r.invoiceSubmitted&&r.paymentReceived===false:['advance','completion'].some(stage=>{const s=sourceByKey.get(r.key)?.[stage];return (stage==='advance'||r.installed)&&s?.submitted===true&&s?.received!==true&&s?.cashReceived!==true;})),ups?due:r=>sum(['advance','completion'].filter(stage=>{const s=sourceByKey.get(r.key)?.[stage];return (stage==='advance'||r.installed)&&s?.submitted===true&&s?.received!==true&&s?.cashReceived!==true;}).map(stage=>{const s=sourceByKey.get(r.key)?.[stage];return money(s?.outstandingAmount??s?.invoiceAmount);}))),advanceReceived:metric(rows,r=>r.advanceReceived)};
  let milestones:ManagementProgramme['milestones'];
  if(!ups){
   const build=(stage:'advance'|'completion'):ProgrammeMilestone=>{
    const s=(r:ProgrammeRow)=>sourceByKey.get(r.key)?.[stage],ready=(r:ProgrammeRow)=>stage==='advance'?sourceByKey.get(r.key)?.solarDelivered===true||r.delivered:r.installed;
    const actual=(r:ProgrammeRow)=>money(s(r)?.invoiceAmount),expected=(r:ProgrammeRow)=>money(s(r)?.expected),received=(r:ProgrammeRow)=>s(r)?.received===true||s(r)?.cashReceived===true;
    return{submitted:metric(rows.filter(r=>s(r)?.submitted===true&&(stage==='advance'||r.installed)),actual),received:metric(rows.filter(received),r=>money(s(r)?.receivedAmount??s(r)?.invoiceAmount)),pending:metric(rows.filter(r=>s(r)?.submitted===true&&(stage==='advance'||r.installed)&&!received(r)),r=>money(s(r)?.outstandingAmount??s(r)?.invoiceAmount)),toSubmit:metric(rows.filter(r=>ready(r)&&s(r)?.submitted!==true),r=>received(r)?'0.00':actual(r)??expected(r)),future:metric(rows.filter(r=>!ready(r)),r=>received(r)?'0.00':expected(r))};
   };milestones={advance:build('advance'),completion:build('completion')};
  }
  return{key,label,capacity,rows,cancelled:scoped.filter(r=>r.cancelled),transferred:scoped.filter(r=>r.transferred),summary,...(milestones?{milestones}:{})};
 });
 return{sourceDate,sourceVersion,readOnly:true,programmes,issues};
}
export function appendIssuedProgrammeSales(snapshot:SourceRow,issued:SourceRow[],sourceDate:string){
 const original=(snapshot.registers??[]).flatMap((r:SourceRow)=>r.rows??[]),excluded=[...(snapshot.cables?.rows??[]),...(snapshot.internet?.rows??[])].map((r:SourceRow)=>String(r.invoice??''));
 const appended:SourceRow[]=[],issues:string[]=[];
 for(const customer of ['UBL','MBL'] as const){
  const byId=new Map<string,SourceRow>(),conflicting=new Set<string>();
  for(const row of issued.filter(r=>r.customer===customer&&r.frameworkType!=='ubl-solar')){const previous=byId.get(row.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))conflicting.add(row.id);else byId.set(row.id,row);}
  for(const id of conflicting){byId.delete(id);issues.push(`Issued IPO ${id} has conflicting immutable observations; it remains held.`);}
  const scoped=[...byId.values()],canonical=canonicalUpsRegister(customer,original,[],scoped,[],new Date(),sourceDate,excluded);
  issues.push(...canonical.identityReview.map((r:any)=>`Issued IPO ${r.ipoId??r.sourceKey??'identity'} held: ${r.reason}`));
  for(const row of canonical.rows.filter(r=>r.source==='Confirmed sale')){
   const source=scoped.find(r=>r.id===row.ipoId);if(!source)continue;
   if(canonical.rows.filter(v=>v.source==='Confirmed sale'&&v.projectReference===row.projectReference&&v.orderNumber===row.orderNumber).length!==1){issues.push(`Issued IPO ${source.id} duplicates a new programme order identity; it remains held.`);continue;}
   const capacity=String(row.orderNumber).split('/')[1],program=customer==='UBL'&&capacity==='250'?'UPS 250':customer==='MBL'&&['80','20','60'].includes(capacity)?'MBL UPS '+capacity:null;
   if(!program){issues.push(`Issued IPO ${source.id} has no supported programme order identity; it remains held.`);continue;}
   // Only immutable IPO values are used. Neither current rates nor inferred cash
   // receipts may replace a missing issued value or create an invoice.
   appended.push({key:'issued:'+source.id,kind:'UPS',customer,program,ipo:source.number,orderNumber:source.orderNumber,site:source.site,siteCode:source.siteCode,po:source.poReference,configuration:source.configuration,grossContract:money(source.grossContract),singlePaymentReceived:null,singleInvoiceSubmitted:false,invoiceReferences:[],accountsReferences:[],cancelled:false,transferred:false,delivered:source.delivered===true,installed:source.installed===true,partialDelivery:source.partialDelivery===true,deliveryDate:source.deliveryDate??null,installationDate:source.installationDate??null,recordKey:'ipo:'+source.id,receiptsUnverified:true,flags:['Confirmed sale after reviewed source cutoff; invoice and payment evidence not yet in the reviewed source.'],sources:[{name:'Immutable issued IPO',ipoId:source.id,recordId:source.recordId,issuedAt:source.issuedAt}],mappingStatus:'New confirmed sale after reviewed source cutoff'});
  }
 }
 for(const source of issued.filter(r=>r.customer==='UBL'&&r.frameworkType==='ubl-solar')){
  if(original.some((r:SourceRow)=>r.key===source.sourceKey))continue;
  const matches=original.filter((r:SourceRow)=>r.program==='Solar 70'&&r.siteCode&&r.siteCode===source.siteCode);
  if(matches.length===1&&matches[0].po===source.poReference)continue;
  const duplicates=issued.filter(r=>r.frameworkType==='ubl-solar'&&r.siteCode===source.siteCode&&r.poReference===source.poReference);
  if(matches.length||duplicates.length!==1||source.historicalImport||!source.siteCode||!source.poReference||(!Number.isFinite(new Date(source.issuedAt).getTime())||new Date(source.issuedAt).toISOString().slice(0,10)<sourceDate)){issues.push(`Issued Solar IPO ${source.id} needs exact programme identity confirmation; it remains held.`);continue;}
  appended.push({key:'issued:'+source.id,kind:'Solar / BESS',customer:'UBL',program:'Solar 70',ipo:source.number,orderNumber:source.orderNumber,site:source.site,siteCode:source.siteCode,po:source.poReference,configuration:source.configuration,grossContract:money(source.grossContract),delivered:false,installed:false,invoiceReferences:[],accountsReferences:[],advance:{submitted:false,received:false},completion:{submitted:false,received:false},recordKey:'ipo:'+source.id,flags:['Confirmed Coordinator IPO; invoice milestones and payments require Accounts evidence.'],sources:[{name:'Immutable issued IPO',ipoId:source.id,issuedAt:source.issuedAt}],mappingStatus:'New confirmed sale after reviewed source cutoff'});
 }
 return{snapshot:{...snapshot,registers:[...(snapshot.registers??[]),{rows:appended}]},issues};
}
export async function managementProgrammes(pool:Pool,actor:string,allowAccounts=false):Promise<ManagementProgrammes>{
 const user=(await pool.query('SELECT active,role FROM users WHERE id=$1',[actor])).rows[0];
 if(!user?.active||!['Admin','Management',...(allowAccounts?['Accounts']:[])].includes(user.role))throw new HttpError(403,'Programme reporting requires Management access.');
 const source=(await pool.query('SELECT version,source_date::text,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 if(!source)throw new HttpError(409,'The reviewed programme source has not been imported.');
 const issued=(await pool.query(`SELECT i.id,i.number,i.created_at AS issued_at,i.snapshot,w.record_id,p.basis,upper(c.short_code) AS customer,
  link_source.snapshot AS operations_snapshot,verified.source_key,f.payload->>'type' AS framework_type
  FROM project_workflow_issuances w JOIN project_workflow_records r ON r.id=w.record_id JOIN customers c ON c.id=r.customer_id
  JOIN project_po_receipts p ON p.id=w.receipt_id JOIN internal_purchase_orders i ON i.id=w.ipo_id
  LEFT JOIN project_framework_versions f ON f.id::text=(p.basis#>>'{source,id}')
  LEFT JOIN LATERAL(SELECT v.snapshot->>'sourceKey' AS source_key,l.board_site_id FROM inventory_material_source_links l JOIN operations_board_versions v ON v.site_id=l.board_site_id AND v.version=l.board_version WHERE l.ipo_id=i.id LIMIT 1)verified ON true
  LEFT JOIN LATERAL(SELECT snapshot FROM operations_board_versions WHERE site_id=verified.board_site_id ORDER BY version DESC LIMIT 1)link_source ON true
  WHERE upper(c.short_code) IN('UBL','MBL') AND r.route='direct-framework'
  AND (p.basis->'source'->>'key' IN('UBL-UPS-6-5','UBL-UPS-6-10','MBL-UPS-6-5','MBL-UPS-6-10') OR upper(c.short_code)='UBL' AND f.payload->>'type'='ubl-solar')
  AND r.data->>'localPreviewArchived' IS DISTINCT FROM 'true' ORDER BY i.created_at,i.id`)).rows;
 const records=[];
 for(const row of issued){
  const identity=await ipoSiteIdentity(pool,row),s=identity.snapshot??row.snapshot,op=row.operations_snapshot;
  records.push({id:row.id,frameworkType:row.framework_type,recordId:row.record_id,customer:row.customer,sourceKey:row.source_key??null,number:row.number,issuedAt:row.issued_at,historicalImport:!!s.historicalImport,orderNumber:s.input?.orderNumber??'',site:s.siteName,siteCode:s.siteCode,poReference:s.input?.poNumber??'',configuration:row.basis.source.key.replace(row.customer+'-UPS-',''),grossContract:s.allocation?.total,delivered:['delivered','completed'].includes(op?.stage),installed:op?.completed===true||op?.stage==='completed',partialDelivery:op?.partialDelivery===true,deliveryDate:op?.deliveryDate,installationDate:op?.completionDate});
 }
 const [stages,invoiceEntries]=await Promise.all([latestProgrammeHandoffs(pool),pool.query('SELECT site_key,pt_reference,milestone FROM accounts_invoice_entries')]);
 const combined=appendIssuedProgrammeSales(source.snapshot,records.map(r=>({...r,delivered:false,installed:false,partialDelivery:false})),source.source_date),result=projectManagementProgrammes(applyProgrammeHandoffs(combined.snapshot,stages,invoiceEntries.rows),source.source_date,source.version);
 result.operationsAsOf=stages.map(s=>s.created_at instanceof Date?s.created_at.toISOString():String(s.created_at??'')).filter(Boolean).sort().at(-1);result.issues.push(...combined.issues);return result;
}
