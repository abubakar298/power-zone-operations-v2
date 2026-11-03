import './site-documents.css';
import {useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {FinancialValue} from '../ui/FinancialValue.js';
import {displayDate} from './SiteDocumentsDialog.js';

const stages=[['advance-delivery','Advance / delivery'],['balance-completion','Balance / completion'],['delivery-only','Delivery only'],['extra-cable','Extra cable'],['internet','Internet']] as const;
const delays=[['qc-pictures','Awaiting QC pictures'],['physical-originals','Awaiting physical originals'],['customer-clarification','Customer clarification'],['other','Other']] as const;
const stageLabel=(id:string)=>stages.find(s=>s[0]===id)?.[1]??id;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function post(path:string,body:Record<string,unknown>){const session=await api<any>('/auth/session');return api<any>(path,{csrf:session.csrfToken,body});}
type Form={kind:'add'}|{kind:'amount'|'delay'|'submit';invoice:any}|{kind:'site-delay'|'site-submit'};

/** Separate PT invoices for one site milestone: each has its own number, amount,
 * date, type, submission and delay reason. Payment receipt stays a separate action. */
export function InvoiceRecords({row,canRecord,onSaved,onDirty}:{row:any;canRecord:boolean;onSaved:(message:string)=>Promise<void>|void;onDirty:(dirty:boolean)=>void}){
 const [form,setFormState]=useState<Form|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
 const defaultStage=row.billingStage==='delivery-only'?'delivery-only':row.milestone==='delivery'?'advance-delivery':'balance-completion';
 const [values,setValues]=useState<Record<string,string>>({});
 const set=(k:string,v:string)=>{setValues(o=>({...o,[k]:v}));onDirty(true);};
 const open=(next:Form|null,initial:Record<string,string>={})=>{setFormState(next);setValues(initial);setError('');setRequestKey(crypto.randomUUID());onDirty(false);};
 async function run(action:()=>Promise<string>){if(saving)return;setSaving(true);setError('');try{const message=await action();open(null);await onSaved(message);}catch(e){setError((e as Error).message);}finally{setSaving(false);}}
 const invoices:any[]=row.invoices??[];
 const legacy=!invoices.length&&row.invoiceCreated;
 // Consolidated extra-cable invoices keep their own submission action.
 const cable=row.sourceKind==='Consolidated cable';
 const submitPath=cable?'/accounts-workspace/cable-consolidations/submit':'/accounts-workspace/invoice-submissions';
 const submitBody=(invoiceEntryId?:string)=>cable?{key:row.key,sourceVersion:row.sourceVersion,submissionDate:values.submissionDate,requestKey}:{sourceKind:row.sourceKind,siteKey:row.key,sourceVersion:row.sourceVersion,milestone:row.milestone,submissionDate:values.submissionDate,...invoiceEntryId?{invoiceEntryId}:{},requestKey};
 return <section className="accounts-record-section">
  <div className="accounts-panel-heading"><h3>Invoices for this {row.billingStage==='delivery-only'?'delivery':row.milestone} milestone</h3>{canRecord&&!form&&!cable&&<Button variant="secondary" onClick={()=>open({kind:'add'},{entryDate:today(),stage:defaultStage})}>{invoices.length||legacy?'Add another invoice':'Record invoice'}</Button>}</div>
  {invoices.length>0&&<div className="pz-table-scroll"><table className="invoice-records-table"><thead><tr><th>SR#</th><th>Invoice</th><th>Stage / type</th><th className="accounts-money">Amount · PKR</th><th>Invoice date</th><th>Submission</th>{canRecord&&<th>Actions</th>}</tr></thead><tbody>{invoices.map((i,n)=><tr key={i.key}>
   <td>{n+1}</td>
   <td><strong>{i.reference}</strong><small>{i.label??'No description'}</small></td>
   <td>{stageLabel(i.stage)}</td>
   <td className="accounts-money">{i.amount?<FinancialValue places={2} value={i.amount}/>:<span className="invoice-flag">Amount not recorded</span>}</td>
   <td>{displayDate(i.entryDate)}</td>
   <td>{i.submittedOn?<StatusBadge tone="success">Submitted {displayDate(i.submittedOn)}</StatusBadge>:<StatusBadge tone="warning">Created — not submitted</StatusBadge>}{!i.submittedOn&&i.delay&&<small>Delay: {i.delay.label}{i.delay.note?` — ${i.delay.note}`:''}</small>}</td>
   {canRecord&&<td><div className="site-documents-actions">{i.submittedOn?<small>Amount changes: Payments to Record</small>:<><Button variant="neutral" onClick={()=>open({kind:'amount',invoice:i},{amount:i.amount??''})}>{i.amount?'Correct amount':'Enter amount'}</Button></>}{!i.submittedOn&&<><Button variant="neutral" onClick={()=>open({kind:'delay',invoice:i},{delayReason:i.delay?.reason??'',delayNote:i.delay?.note??''})}>Delay reason</Button><Button variant="primary" onClick={()=>open({kind:'submit',invoice:i},{submissionDate:''})}>Mark submitted</Button></>}</div></td>}
  </tr>)}</tbody></table></div>}
  {legacy&&<div><p><strong>Invoice {(row.invoiceReferences??[]).join(' / ')}</strong><br/><small>Existing reference from the reviewed Accounts register. Its amount and balance stay as recorded there.</small></p>{row.siteDelay&&<p><small>Delay: {row.siteDelay.label}{row.siteDelay.note?` — ${row.siteDelay.note}`:''}</small></p>}{canRecord&&!form&&<div className="site-documents-actions"><Button variant="neutral" onClick={()=>open({kind:'site-delay'},{delayReason:row.siteDelay?.reason??'',delayNote:row.siteDelay?.note??''})}>Delay reason</Button><Button variant="primary" onClick={()=>open({kind:'site-submit'},{submissionDate:''})}>Mark submitted</Button></div>}</div>}
  {!invoices.length&&!legacy&&!form&&<p>No invoice has been recorded for this milestone yet.</p>}

  {form?.kind==='add'&&<form className="invoice-record-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await post('/accounts-workspace/invoice-entries',{sourceKind:row.sourceKind,siteKey:row.key,sourceVersion:row.sourceVersion,milestone:row.milestone,ptReference:values.ptReference??'',entryDate:values.entryDate,notes:values.notes??'',invoiceStage:values.stage,...values.label?.trim()?{invoiceLabel:values.label.trim()}:{},...values.amount?.trim()?{amount:values.amount.trim()}:{},requestKey});return `Invoice ${values.ptReference} recorded. It stays in Invoices to Submit until you record its actual submission date.`;});}}>
   <div className="pz-form-grid" style={{alignItems:'start'}}>
    <Field id="invoice-new-reference" label="PT invoice number"><input id="invoice-new-reference" required maxLength={200} value={values.ptReference??''} onChange={e=>set('ptReference',e.target.value)} disabled={saving}/></Field>
    <Field id="invoice-new-label" label="Description (for example Solar Panels)"><input id="invoice-new-label" maxLength={200} value={values.label??''} onChange={e=>set('label',e.target.value)} disabled={saving}/></Field>
    <Field id="invoice-new-stage" label="Stage / type"><select id="invoice-new-stage" value={values.stage} onChange={e=>set('stage',e.target.value)} disabled={saving}>{stages.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
    <Field id="invoice-new-amount" label="Invoice amount · PKR"><input id="invoice-new-amount" inputMode="decimal" pattern="\d{1,14}(\.\d{1,2})?" value={values.amount??''} onChange={e=>set('amount',e.target.value)} disabled={saving} placeholder="Leave blank if not yet known"/></Field>
    <Field id="invoice-new-date" label="Invoice date"><input id="invoice-new-date" type="date" required max={today()} value={values.entryDate} onChange={e=>set('entryDate',e.target.value)} disabled={saving}/></Field>
    <Field id="invoice-new-notes" label="Notes"><textarea id="invoice-new-notes" maxLength={2000} value={values.notes??''} onChange={e=>set('notes',e.target.value)} disabled={saving}/></Field>
   </div>
   <p className="pz-caption">One invoice number per record. Recording an invoice does not record a payment.</p>
   <FormButtons saving={saving} label="Save invoice" disabled={!values.ptReference?.trim()} onCancel={()=>open(null)}/>
  </form>}
  {form?.kind==='amount'&&<form className="invoice-record-form" onSubmit={e=>{e.preventDefault();const i=form.invoice;void run(async()=>{await post('/accounts-workspace/invoice-updates',{invoiceKey:i.key,version:i.updateVersion,amount:values.amount.trim(),reason:values.reason??'',requestKey});return `Amount saved for invoice ${i.reference}. No payment was recorded.`;});}}>
   <p><strong>{form.invoice.reference}</strong> · {form.invoice.amount?'correct the saved amount':'enter the invoice amount from PT'}</p>
   <div className="pz-form-grid" style={{alignItems:'start'}}>
    <Field id="invoice-amount" label="Invoice amount · PKR"><input id="invoice-amount" required inputMode="decimal" pattern="\d{1,14}(\.\d{1,2})?" value={values.amount??''} onChange={e=>set('amount',e.target.value)} disabled={saving}/></Field>
    {form.invoice.amount&&<Field id="invoice-amount-reason" label="Reason for correction"><textarea id="invoice-amount-reason" required maxLength={2000} value={values.reason??''} onChange={e=>set('reason',e.target.value)} disabled={saving}/></Field>}
   </div>
   <FormButtons saving={saving} label="Save amount" disabled={!values.amount?.trim()} onCancel={()=>open(null)}/>
  </form>}
  {(form?.kind==='delay'||form?.kind==='site-delay')&&<form className="invoice-record-form" onSubmit={e=>{e.preventDefault();const key=form.kind==='delay'?form.invoice.key:row.siteDelayKey,version=form.kind==='delay'?form.invoice.updateVersion:row.siteDelayVersion;void run(async()=>{await post('/accounts-workspace/invoice-updates',{invoiceKey:key,version,delayReason:values.delayReason||null,delayNote:values.delayNote??'',requestKey});return values.delayReason?'Delay reason saved. The invoice stays pending until its submission date is recorded.':'Delay reason cleared.';});}}>
   <div className="pz-form-grid" style={{alignItems:'start'}}>
    <Field id="invoice-delay-reason" label="Why is submission delayed?"><select id="invoice-delay-reason" value={values.delayReason??''} onChange={e=>set('delayReason',e.target.value)} disabled={saving}><option value="">No delay reason</option>{delays.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
    <Field id="invoice-delay-note" label={values.delayReason==='other'?'Note (required)':'Note'}><textarea id="invoice-delay-note" required={values.delayReason==='other'} maxLength={2000} value={values.delayNote??''} onChange={e=>set('delayNote',e.target.value)} disabled={saving}/></Field>
   </div>
   <FormButtons saving={saving} label="Save delay reason" disabled={values.delayReason==='other'&&!values.delayNote?.trim()} onCancel={()=>open(null)}/>
  </form>}
  {(form?.kind==='submit'||form?.kind==='site-submit')&&<form className="invoice-record-form" onSubmit={e=>{e.preventDefault();const entry=form.kind==='submit'?form.invoice.entryId:undefined;void run(async()=>{const saved=await post(submitPath,submitBody(entry));return `Invoice ${saved.invoice_reference} marked submitted on ${displayDate(saved.submitted_on)}. It now appears in Payments to Record · Awaiting payment.`;});}}>
   <p><strong>Invoice {form.kind==='submit'?form.invoice.reference:(row.invoiceReferences??[]).join(' / ')}</strong></p>
   <Field id="invoice-submission-date" label="Actual submission date"><input id="invoice-submission-date" type="date" required max={today()} value={values.submissionDate??''} onChange={e=>set('submissionDate',e.target.value)} disabled={saving}/></Field>
   <p className="pz-caption">Record the date the invoice was actually submitted. Payment receipt is recorded separately.</p>
   <FormButtons saving={saving} label="Save submission" disabled={!values.submissionDate} onCancel={()=>open(null)}/>
  </form>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
function FormButtons({saving,label,disabled,onCancel}:{saving:boolean;label:string;disabled:boolean;onCancel:()=>void}){
 return <div className="site-documents-actions"><Button variant="primary" type="submit" disabled={saving||disabled}>{saving?'Saving…':label}</Button><Button variant="neutral" type="button" disabled={saving} onClick={onCancel}>Cancel</Button></div>;
}
