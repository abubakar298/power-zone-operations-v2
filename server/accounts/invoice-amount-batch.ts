import {Decimal} from 'decimal.js';
import type {Pool,PoolClient} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction} from '../db/transaction.js';
import {lockActiveActor} from '../auth/actor-lock.js';
import {HttpError} from '../http/errors.js';
import {AccountsRepository} from './repository.js';
import {paymentRegisterData} from './payment-records.js';
import {amountRule,confirmationSource} from './invoice-corrections.js';
import {invoiceReviewGroup} from '../../shared/accounts-invoice-review.js';
import {invoiceType} from '../../shared/accounts-invoice-display.js';
type Row=Record<string,any>;

/** Owner-confirmed 4 November 2026, including tax. UBL is the remaining balance invoice
 * (900,000 per set less the 450,000 advance already received) — never the full contract. */
export const confirmedUpsProgrammes=[
 {id:'ubl-ups-250',label:'UBL UPS — CHP-163, 6 kW / 10 kWh',customer:'United Bank Limited',registerCustomer:'UBL',programs:['UPS 250','UBL UPS 250'],ipo:'CHP-163',configuration:['6','10'],amount:'450000.00'},
 {id:'mbl-ups-80',label:'Meezan UPS — 80-site programme, 6 kW / 5 kWh',customer:'Meezan Bank Limited',registerCustomer:'MBL',programs:['MBL UPS 80'],ipo:null,configuration:['6','5'],amount:'660000.00'},
] as const;
export const invoiceAmountBatchBasis='Owner-confirmed 4 November 2026 standard UPS invoice amounts including tax: UBL CHP-163 6 kW / 10 kWh PKR 450,000 (remaining balance invoice; 900,000 per set less the 450,000 advance already received); Meezan 80-site 6 kW / 5 kWh PKR 660,000.';
const reviewGroup='balance-without-total';
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyFor=(seed:string)=>{const h=fingerprint(seed);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const sameReference=(s:unknown)=>String(s??'').trim().replace(/\s+/g,' ').toLowerCase();
/** Configuration text such as "6 kW / 10 kWh" or "6-10"; only a clearly different system is an exception. */
function configurationDiffers(value:unknown,expected:readonly string[]){if(value==null||String(value).trim()==='')return false;const numbers=String(value).match(/\d+(?:\.\d+)?/g)??[];return numbers.length<2||numbers[0]!==expected[0]||numbers[1]!==expected[1];}

export type AmountBatchLine={rowId:string;invoice:string;site:string;customer:string;programme:string;ipo:string;order:string;currentAmount:null;proposedAmount:string;outstanding:string;received:string|null;correctionVersion:number;rule:string};
export type AmountBatchSkip={rowId:string;invoice:string;site:string;customer:string;kind:'skipped'|'exception';reason:string};

/** Live re-check of the review group. Every record is matched by customer, programme and its
 * own single site/order record — never selected only because its amount is blank. */
export function planInvoiceAmountBatch(register:{invoices:Row[];receipts:any[];sourceVersion:number},registerRows:Row[]){
 const byKey=new Map(registerRows.map(r=>[String(r.key),r]));
 const eligible:AmountBatchLine[]=[],skipped:AmountBatchSkip[]=[];
 for(const row of register.invoices.filter(r=>invoiceReviewGroup(r)===reviewGroup)){
  const base={rowId:String(row.id),invoice:String(row.invoice??''),site:String(row.site??''),customer:String(row.customer??'')};
  const skip=(reason:string)=>skipped.push({...base,kind:'skipped',reason}),flag=(reason:string)=>skipped.push({...base,kind:'exception',reason});
  const programme=confirmedUpsProgrammes.find(p=>p.customer===row.customer);
  if(!programme){skip('Not a confirmed customer programme (for example delivery-only or another customer).');continue;}
  if(row.category!=='System'){skip(`Not a standard UPS system invoice (${row.category}).`);continue;}
  if(row.consolidation||row.legacyStageId||(row.sourceKeys?.length??1)>1||/\s+\/\s+|,|&|\+/.test(String(row.invoice??''))){flag('Combined, consolidated or multi-site invoice reference.');continue;}
  const source=byKey.get(String(row.sourceKey??'').replace(/^registered-/,''));
  if(!source){flag('No single register record links this invoice to a site and order.');continue;}
  if(source.kind!=='UPS'||source.customer!==programme.registerCustomer){skip('Register record is not a UPS system of this customer.');continue;}
  if(!(programme.programs as readonly string[]).includes(String(source.program??''))){skip(`Other programme (${source.program||'not recorded'}) — not covered by this confirmation.`);continue;}
  if(programme.ipo&&String(source.ipo??'').trim().toUpperCase()!==programme.ipo){flag(`Programme IPO is ${source.ipo||'not recorded'}, expected ${programme.ipo}.`);continue;}
  if(source.cancelled===true||source.transferred===true){flag('Register record is cancelled or transferred.');continue;}
  if(sameReference(source.site)!==sameReference(row.site)){flag('Invoice site does not match its register record.');continue;}
  if(['configuration','variant','systemSize'].some(k=>configurationDiffers(source[k],programme.configuration))){flag(`Register configuration differs from ${programme.label.split('— ')[1]}.`);continue;}
  if(register.invoices.some(r=>r.id!==row.id&&r.customer===row.customer&&invoiceType(r)===invoiceType(row)&&sameReference(r.invoice)===sameReference(row.invoice))){flag('Another invoice record uses the same invoice number.');continue;}
  const rule=amountRule(row,false);
  if(rule.hold){flag(rule.hold);continue;}
  if(rule.minimum&&new Decimal(programme.amount).lt(rule.minimum)){flag(`Outstanding plus recorded payments (${rule.minimum}) exceed the confirmed amount ${programme.amount}.`);continue;}
  eligible.push({...base,programme:programme.label,ipo:String(source.ipo??''),order:String(source.orderNumber??source.key??''),currentAmount:null,proposedAmount:programme.amount,outstanding:new Decimal(row.pending).toFixed(2),received:row.operationalReceived??null,correctionVersion:Number(row.correctionVersion??0),rule:rule.rule});
 }
 const order=(label:string)=>confirmedUpsProgrammes.findIndex(p=>p.label===label);
 eligible.sort((a,b)=>order(a.programme)-order(b.programme)||a.invoice.localeCompare(b.invoice,undefined,{numeric:true}));
 const totals=confirmedUpsProgrammes.map(p=>{const rows=eligible.filter(r=>r.programme===p.label);return {programme:p.label,amount:p.amount,count:rows.length,total:rows.reduce((n,r)=>n.plus(r.proposedAmount),new Decimal(0)).toFixed(2),outstanding:rows.reduce((n,r)=>n.plus(r.outstanding),new Decimal(0)).toFixed(2)};});
 const fp=fingerprint({sourceVersion:register.sourceVersion,lines:eligible.map(r=>[r.rowId,r.correctionVersion,r.proposedAmount,r.outstanding,r.received])});
 return {sourceVersion:register.sourceVersion,fingerprint:fp,reference:'UPS-AMT-'+fp.slice(0,10).toUpperCase(),basis:invoiceAmountBatchBasis,eligible,skipped,totals,total:eligible.reduce((n,r)=>n.plus(r.proposedAmount),new Decimal(0)).toFixed(2)};
}

async function access(pool:Pool,actor:string,c:Pool|PoolClient){if(!['Admin','Accounts'].includes(await new AccountsRepository(pool).access(actor,c)))throw new HttpError(403,'Accounts invoice editing access required.');}
async function plan(c:Pool|PoolClient){
 const register=await paymentRegisterData(c),source=(await c.query('SELECT version,snapshot FROM accounts_source_registers ORDER BY version DESC LIMIT 1')).rows[0];
 return planInvoiceAmountBatch(register,(source?.snapshot.registers??[]).flatMap((r:any)=>r.rows??[]));
}
export async function previewInvoiceAmountBatch(pool:Pool,actor:string){
 await access(pool,actor,pool);
 const batches=(await pool.query("SELECT b.reference,b.source_version,jsonb_array_length(b.applied) AS applied,b.created_at,u.display_name AS applied_by FROM accounts_invoice_amount_batches b JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC")).rows;
 return {...await plan(pool),batches};
}
export const invoiceAmountBatchSchema=z.object({fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** One transaction: saves the reviewed before-state, then one amount confirmation per invoice.
 * Rerunning the same review returns the saved batch; nothing is applied twice. */
export async function applyInvoiceAmountBatch(pool:Pool,actor:string,raw:unknown){
 const input=invoiceAmountBatchSchema.parse(raw);
 return transaction(pool,async c=>{
  await lockActiveActor(c,actor);await access(pool,actor,c);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accounts.source-register',0))");
  const done=(await c.query('SELECT reference,applied FROM accounts_invoice_amount_batches WHERE fingerprint=$1',[input.fingerprint])).rows[0];
  if(done)return {reference:done.reference,applied:done.applied.length,alreadyApplied:true};
  const current=await plan(c);
  if(current.fingerprint!==input.fingerprint)throw new HttpError(409,'Invoice records changed since this list was reviewed. Review the list again before applying.');
  if(!current.eligible.length)throw new HttpError(422,'No eligible invoice amounts to apply.');
  const register=await paymentRegisterData(c),batchId=randomUUID(),reason=`${current.reference} · ${invoiceAmountBatchBasis}`.slice(0,2000);
  const applied=[];
  for(const line of current.eligible){
   const row=register.invoices.find(r=>r.id===line.rowId)!;
   const snapshot={originalInvoice:row.originalInvoice??row.invoice,customer:row.customer,site:row.site,invoiceType:invoiceType(row),previousInvoice:row.invoice,previousDate:row.date??null,confirmedAmount:new Decimal(line.proposedAmount).toFixed(2),outstandingRule:line.rule,...confirmationSource(row,register),batchReference:current.reference,batchId};
   const request={batchReference:current.reference,fingerprint:input.fingerprint,sourceRowId:row.id,confirmedAmount:line.proposedAmount};
   const saved=(await c.query('INSERT INTO accounts_invoice_corrections(id,source_row_id,source_version,version,invoice_reference,submitted_on,reason,snapshot,request,request_key,created_by) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10) RETURNING id',[randomUUID(),row.id,current.sourceVersion,line.correctionVersion+1,row.invoice,reason,snapshot,request,keyFor(input.fingerprint+':'+row.id),actor])).rows[0];
   applied.push({correctionId:saved.id,rowId:row.id,invoice:row.invoice,amount:line.proposedAmount,outstanding:line.outstanding});
  }
  await c.query('INSERT INTO accounts_invoice_amount_batches(id,reference,fingerprint,source_version,basis,before_state,applied,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[batchId,current.reference,input.fingerprint,current.sourceVersion,invoiceAmountBatchBasis,JSON.stringify({eligible:current.eligible,skipped:current.skipped,totals:current.totals}),JSON.stringify(applied),actor]);
  await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`accounts.invoice-amount-batch:${current.reference}:${applied.length}`]);
  return {reference:current.reference,applied:applied.length,total:current.total,totals:current.totals,skipped:current.skipped.length,alreadyApplied:false};
 });
}
