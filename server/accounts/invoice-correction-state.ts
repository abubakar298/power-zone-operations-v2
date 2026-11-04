import {sameInvoiceCustomer} from './invoice-customer-identity.js';
import type{Pool,PoolClient}from'pg';
type Row=Record<string,any>;
export async function invoiceCorrections(db:Pool|PoolClient){return(await db.query('SELECT c.*,c.submitted_on::text AS submitted_on,u.display_name AS changed_by FROM accounts_invoice_corrections c JOIN users u ON u.id=c.created_by ORDER BY c.created_at,c.version')).rows;}
/** Apply exact-row metadata only; never move balances between phases or invoices. */
export function applyInvoiceCorrections(rows:Row[],events:Row[]):Row[]{return rows.map(row=>{
 const changes=events.filter(e=>e.source_row_id===row.id),last=changes.at(-1);
 if(!last)return{...row,correctionVersion:0,correctionHistory:[]};
 const history=changes.map(e=>({version:e.version,invoice:e.invoice_reference,submissionDate:e.submitted_on,reason:e.reason,changedBy:e.changed_by,at:e.created_at,previousInvoice:e.snapshot.previousInvoice,previousDate:e.snapshot.previousDate,confirmedAmount:e.snapshot.confirmedAmount,confirmedOutstanding:e.snapshot.confirmedOutstanding}));
 if(last.snapshot.originalInvoice!==row.invoice||!sameInvoiceCustomer(row,last.snapshot.customer))return{...row,correctionVersion:last.version,correctionHistory:history,invoiceCorrectionHold:'The imported invoice identity changed after an Accounts correction. Reconcile the source before editing or recording payment.'};
 // PT confirmations: the invoice amount (with or without its balance), or a balance saved on its own.
 const amounts=changes.filter(e=>e.snapshot.confirmedAmount!==undefined||e.snapshot.confirmedOutstanding!==undefined),confirmed=amounts.at(-1);
 if(confirmed&&(String(confirmed.snapshot.sourceAmount??'')!==String(row.amount??'')||String(confirmed.snapshot.sourcePending??'')!==String(row.pending??'')))return{...row,correctionVersion:last.version,correctionHistory:history,invoiceCorrectionHold:'The imported financial amounts changed after PT confirmation. Reconcile the source before editing or recording payment.'};
 // Amount-only confirmations keep a known balance (receipts are applied afterwards);
 // with no payment anywhere the balance is the invoice amount.
 // A balance saved on its own stays the known balance when the amount is confirmed later,
 // and an amount confirmed earlier stays when a balance is saved on its own later.
 const earlier=amounts.slice(0,-1),savedBalance=earlier.filter(e=>e.snapshot.confirmedAmount===undefined).at(-1)?.snapshot.confirmedOutstanding,savedAmount=earlier.filter(e=>e.snapshot.confirmedAmount!==undefined).at(-1)?.snapshot.confirmedAmount;
 const c=confirmed?.snapshot,amount=c?.confirmedAmount??savedAmount,pending=!c?undefined:c.confirmedOutstanding!==undefined?c.confirmedOutstanding:c.outstandingRule==='no-payments'?c.confirmedAmount:savedBalance??row.pending;
 const pendingBasis=!c?undefined:c.confirmedOutstanding!==undefined||(c.outstandingRule==='kept'&&savedBalance!==undefined)?'Accounts confirmed against PT':c.outstandingRule==='no-payments'?'Invoice amount; no payment recorded':c.outstandingRule==='from-receipts'?'Recorded payments':(row.pendingBasis??'Existing balance kept');
 return{...row,...(confirmed?{originalAmount:row.amount,originalPending:row.pending,amount:amount??row.amount,pending,...amount!==undefined?{invoiceAmountBasis:'Accounts confirmed against PT'}:{},pendingBasis}:{}),originalInvoice:row.invoice,invoiceReferenceAliases:[...new Set([row.invoice,...changes.map(e=>e.invoice_reference)])],invoice:last.invoice_reference,date:last.submitted_on??row.date,submission:last.submitted_on?'Submitted':row.submission,correctionVersion:last.version,correctionHistory:history};
});}
