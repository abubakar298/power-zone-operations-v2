import {useRef,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {extractText} from '../ocr.js';
import {directPoIdentity} from '../../server/project-workflow/direct-po-identity.js';
import {ublPoSuggestions} from '../../server/orders/po-extraction.js';
const agreements=['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'];
export function DirectPo({refs,session,records,onPrepared,onCancel}:any){
 const [agreement,setAgreement]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[reading,setReading]=useState<any>();
 const request=useRef(crypto.randomUUID());
 const framework=refs.frameworks.find((f:any)=>f.id===agreement),customer=refs.customers.find((c:any)=>c.id===framework?.customer_id);
 async function read(file?:File){
  if(!file||!customer)return;setError('');setReading(undefined);setBusy(true);request.current=crypto.randomUUID();
  try{
   if(file.size>8388608)throw Error('Use a PO attachment up to 8 MB.');
   const extracted=await extractText(file,setProgress),identity=directPoIdentity(extracted.text);
   const matches=refs.sites.filter((s:any)=>s.customer_id===customer.id&&String(s.code)===identity.code);
   if(matches.length>1)throw Error('More than one saved branch uses this code. Ask Management to check the customer register.');
   if(!matches.length&&!identity.name)throw Error('The branch is not in the customer register and its name could not be read. Upload a clearer PO.');
   if(matches[0]&&matches[0].status!=='Active')throw Error('This saved branch is inactive. Ask Management to review it.');
   const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
   setReading({file:{filename:file.name,mime:file.type,base64},text:extracted.text,identity,site:matches[0],amounts:ublPoSuggestions(extracted.text)});
  }catch(e){setError(e instanceof Error?e.message:'Unable to read the PO.');}finally{setBusy(false);setProgress('');}
 }
 async function prepare(){
  setError('');if(!customer||!framework||!reading)return;setBusy(true);
  try{
   const selected=reading.site,existing=selected&&records.find((r:any)=>r.siteId===selected.id&&!['issued','declined'].includes(r.stage));
   let id:string;
   if(existing){if(existing.route!=='direct-framework'||existing.frameworkId!==agreement||existing.stage!=='po_receipt')throw Error('This branch already has active work. Open its existing document in PO Receipt.');id=existing.id;}
   else{const result=await api<any>('/project-workflow',{csrf:session.csrfToken,body:{requestKey:request.current,customerId:customer.id,siteId:selected?.id,siteVersion:selected?.version,siteName:selected?.name??reading.identity.name,siteCode:reading.identity.code,region:selected?.region??'',siteAddress:selected?.location??'',siteContact:selected?.contact_person??'',sitePhone:selected?.contact_phone??'',route:'direct-framework',frameworkId:framework.id,notes:`Direct PO against ${framework.configuration_key} v${framework.version}; branch code ${reading.identity.sourceCode} read from ${reading.file.filename}.`}});id=result.id;}
   const file=await api<any>(`/project-workflow/${id}/files`,{csrf:session.csrfToken,body:{kind:'PO / confirmation',...reading.file}});
   await onPrepared(id,{recordId:id,document:{...file,filename:reading.file.filename,mime:reading.file.mime},text:reading.text,amounts:reading.amounts});
  }catch(e){setError(e instanceof Error?e.message:'Unable to open PO review.');}finally{setBusy(false);}
 }
 return <section className="pz-panel pz-stack pz-workflow-form">
  <div><Button variant="neutral" onClick={onCancel}>Back to PO Receipt</Button></div><h2>Direct PO</h2>
  <div className="pz-form-grid">
   <Field id="direct-po-agreement" label="Accepted quotation"><select id="direct-po-agreement" disabled={busy} value={agreement} onChange={e=>{setAgreement(e.target.value);setReading(undefined);setError('');request.current=crypto.randomUUID();}}><option value="">Select accepted quotation</option>{agreements.map(key=>{const f=refs.frameworks.find((v:any)=>v.configuration_key===key&&v.routes?.includes('direct-framework'));return f?<option key={key} value={f.id}>{key.replace('-UPS-',' (')})</option>:null;})}</select></Field>
   <Field id="direct-po-upload" label="Upload PO" hint="PDF, PNG or JPEG · up to 8 MB"><input key={agreement} id="direct-po-upload" type="file" accept="application/pdf,image/png,image/jpeg" disabled={!customer||busy} onChange={e=>void read(e.target.files?.[0])}/></Field>
  </div>
  {customer&&<section className="ipo-customer-summary"><h3>{customer.name}</h3><p>{customer.contact_person||'Contact person not entered'} · {customer.phone||'Contact number not entered'} · {customer.email||'Email not entered'}</p><p>Billing address: {customer.address||'Not entered'}</p></section>}
  {(refs.frameworkAttachments??[]).filter((f:any)=>f.framework_id===agreement).map((f:any)=><section className="pz-panel pz-stack" key={f.id}><h3>Agreement reference</h3><p>{f.summary.reference} · {f.summary.quantity} systems · {f.summary.configuration}</p><p>Delivery: {f.summary.deliveryLocation}</p><p className="form-note">Reference only. Upload the received PO for each new order; this attachment is not used to confirm a sale.</p><a href={`/api/project-workflow/framework-reference-attachments/${f.id}`} target="_blank" rel="noreferrer">View reference PO — {f.filename}</a></section>)}
  {progress&&<p role="status">{progress}</p>}
  {reading&&<><p role="status">Attached: {reading.file.filename}</p><p>PO branch: <strong>{reading.identity.code} · {reading.site?.name??reading.identity.name}</strong></p><p className="form-note">Branch read from the PO. Review the comparison and IPO/PT before confirming sale.</p><div className="pz-action-row"><Button variant="primary" loading={busy} loadingLabel="Opening PO review…" onClick={()=>void prepare()}>Review PO</Button></div></>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
