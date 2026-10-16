import {FileUpload} from '../ui/FileUpload.js';
import {DirectPoDetailsFields} from './DirectPoDetailsFields.js';
import {useRef,useState} from 'react';
import {api} from '../api.js';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {extractText} from '../ocr.js';
import {directPoSuggestions,directPoSiteMatches,validOrderPosition,directPoCapacityIssues} from '../../shared/direct-po-reading.js';
import {useUnsavedChanges} from '../hooks/useUnsavedChanges.js';
import {ublPoSuggestions} from '../../server/orders/po-extraction.js';
const agreements=['MBL-UPS-6-5','MBL-UPS-6-10','UBL-UPS-6-10'];
export function DirectPo({refs,session,records,onPrepared,onCancel}:any){
 const [agreement,setAgreement]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(''),[reading,setReading]=useState<any>();
 const [evidenceType,setEvidenceType]=useState('Customer PO');
 const [pendingFile,setPendingFile]=useState<File>();
 const [values,setValues]=useState<Record<string,string>>({}),[ipoWarning,setIpoWarning]=useState('');
 useUnsavedChanges(!!reading||!!pendingFile);
 const request=useRef(crypto.randomUUID());
 const framework=refs.frameworks.find((f:any)=>f.id===agreement),customer=refs.customers.find((c:any)=>c.id===framework?.customer_id);
 const capacityIssues=reading?directPoCapacityIssues(reading.text,framework?.configuration_key??''):[];
 const meezan=framework?.configuration_key?.startsWith('MBL-UPS-'),emailApproval=meezan&&evidenceType==='Email approval';
 async function read(file?:File){
  if(!file||!customer)return;setError('');setReading(undefined);setBusy(true);request.current=crypto.randomUUID();
  try{
   if(file.size>8388608)throw Error('Use an evidence attachment up to 8 MB.');
   const extracted=await extractText(file,setProgress,false,emailApproval?25:5),suggestions=directPoSuggestions(extracted.text,customer),identity={code:suggestions.siteCode,name:suggestions.siteName};
   const poRead=ublPoSuggestions(extracted.text);
   if(!suggestions.approvalDate)suggestions.approvalDate=poRead.orderDate??'';
   if(!suggestions.approvalSubject&&poRead.poNumber)suggestions.approvalSubject='Customer PO '+poRead.poNumber;
   const matches=refs.sites.filter((s:any)=>directPoSiteMatches(s,customer.id,identity.code,identity.name,suggestions.siteAddress??'',framework?.configuration_key==='UBL-UPS-6-10'));
   if(matches.length>1)throw Error('More than one saved branch uses this code. Ask Management to check the customer register.');

   if(matches[0]&&matches[0].status!=='Active')throw Error('This saved branch is inactive. Ask Management to review it.');
   const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
   setValues({...suggestions,...(matches[0]?{siteName:matches[0].name,siteAddress:suggestions.siteAddress||matches[0].location||''}:{} )});setIpoWarning('');
   setPendingFile(undefined);
   setReading({extracted:suggestions,file:{filename:file.name,mime:file.type,base64},text:extracted.text,identity,site:matches[0],amounts:ublPoSuggestions(extracted.text)});
  }catch(e){setError(e instanceof Error?e.message:'Unable to read the evidence.');}finally{setBusy(false);setProgress('');}
 }
 async function prepare(){
  setError('');if(!customer||!framework||!reading)return;setBusy(true);
  try{
   if(capacityIssues.length)throw Error(capacityIssues.join(' '));
   if(!values.siteCode?.trim()||!values.siteName?.trim())throw Error('Enter the branch code and site name read from the evidence.');
   if(!values.approvalDate)throw Error('Enter the approval date.');
   if(values.orderNumber&&!validOrderPosition(values.orderNumber))throw Error('Use an order number such as 20/60.');
   const selected=refs.sites.find((s:any)=>directPoSiteMatches(s,customer.id,values.siteCode,values.siteName,values.siteAddress??'',framework?.configuration_key==='UBL-UPS-6-10')),existing=selected&&records.find((r:any)=>r.siteId===selected.id&&!['issued','declined'].includes(r.stage));
   if(values.ipoNumber?.trim()){const check=await api<any>(`/project-workflow/ipo-number-availability?number=${encodeURIComponent(values.ipoNumber.trim())}`);if(!check.available)throw Error('This IPO number is already in use. Review the existing IPO before continuing.');}
   let id:string;
   if(existing){if(existing.route!=='direct-framework'||existing.frameworkId!==agreement||existing.stage!=='po_receipt')throw Error('This branch already has active work. Open its existing document in PO Receipt.');id=existing.id;}
   else{const result=await api<any>('/project-workflow',{csrf:session.csrfToken,body:{requestKey:request.current,customerId:customer.id,siteId:selected?.id,siteVersion:selected?.version,siteName:selected?.name??values.siteName,siteCode:values.siteCode,region:selected?.region??'',siteAddress:values.siteAddress??selected?.location??'',siteContact:values.siteContact??selected?.contact_person??'',sitePhone:values.sitePhone??selected?.contact_phone??'',route:'direct-framework',frameworkId:framework.id,notes:`Direct PO against ${framework.configuration_key} v${framework.version}; branch code ${values.siteCode} read from ${reading.file.filename}; evidence type: ${evidenceType}.`}});id=result.id;}
   const file=await api<any>(`/project-workflow/${id}/files`,{csrf:session.csrfToken,body:{kind:'PO / confirmation',...reading.file}});
   const current=await api<any>(`/project-workflow/${id}`);
   await api(`/project-workflow/${id}/actions`,{csrf:session.csrfToken,body:{version:current.record.version,requestKey:crypto.randomUUID(),action:'save-direct-po-details',input:{evidenceId:file.id,evidenceType,extracted:reading.extracted,sourceText:reading.text,values,notes:'Reviewed editable details extracted from Direct PO approval evidence.'}}});
   await onPrepared(id,{recordId:id,reviewIpo:true,values,evidenceType,document:{...file,filename:reading.file.filename,mime:reading.file.mime},text:reading.text,amounts:reading.amounts});
  }catch(e){setError(e instanceof Error?e.message:'Unable to open PO review.');}finally{setBusy(false);}
 }
 return <section className="pz-panel pz-stack pz-workflow-form pz-direct-po-form">
  <div><Button variant="neutral" onClick={onCancel}>Back to PO Receipt</Button></div><h2>Direct PO</h2>
  <div className="pz-form-grid">
   <Field id="direct-po-agreement" label="Accepted quotation"><select id="direct-po-agreement" disabled={busy} value={agreement} onChange={e=>{setAgreement(e.target.value);setEvidenceType('Customer PO');setReading(undefined);setPendingFile(undefined);setValues({});setError('');request.current=crypto.randomUUID();}}><option value="">Select accepted quotation</option>{agreements.map(key=>{const f=refs.frameworks.find((v:any)=>v.configuration_key===key&&v.routes?.includes('direct-framework'));return f?<option key={key} value={f.id}>{key.replace('-UPS-',' (')})</option>:null;})}</select></Field>
   <Field id="direct-po-evidence-type" label="Approval evidence"><select id="direct-po-evidence-type" value={evidenceType} disabled={busy||!customer} onChange={e=>{setEvidenceType(e.target.value);setReading(undefined);setPendingFile(undefined);setValues({});setError('');request.current=crypto.randomUUID();}}><option>Customer PO</option>{meezan&&<option>Email approval</option>}</select></Field>
   <div className="pz-field-wide pz-direct-po-evidence-row"><Field id="direct-po-upload" label={emailApproval?"Upload email evidence":"Upload PO"} hint="PDF, PNG or JPEG · up to 8 MB"><FileUpload selectedFiles={pendingFile?[pendingFile]:[]} attachments={reading?[{id:'direct-po-evidence',filename:reading.file.filename}]:undefined} onRemoveAttachment={()=>{setReading(undefined);setPendingFile(undefined);setValues({});setError('');setIpoWarning('');}} onClear={()=>{setReading(undefined);setPendingFile(undefined);setValues({});setError('');setIpoWarning('');}} key={agreement+evidenceType} id="direct-po-upload" type="file" accept="application/pdf,image/png,image/jpeg" disabled={!customer||busy} onChange={e=>{setPendingFile(e.target.files?.[0]);setReading(undefined);setValues({});setError('');setIpoWarning('');}}/></Field><Button variant="primary" className="pz-direct-po-upload-action" loading={busy} loadingLabel="Reading…" disabled={!pendingFile||!customer||busy} onClick={()=>void read(pendingFile)}>{reading&&!pendingFile?'Uploaded':'Upload'}</Button></div>
  </div>



  {progress&&<p role="status">{progress}</p>}
  {reading&&<section className="pz-stack pz-direct-po-details" aria-label="PO details, please verify"><header className="pz-direct-po-details-heading"><h3>PO details, please verify</h3><p>Review the autofilled information and enter any missing details.</p></header>
   {capacityIssues.length>0&&<p role="alert" className="form-error">{capacityIssues.join(" ")}</p>}
   <p className="pz-caption pz-direct-po-configuration">Configuration: {framework?.configuration_key}</p>
   {framework?.configuration_key==='UBL-UPS-6-10'&&values.siteCode==='0999'&&<p className="form-note">0999: branch under construction; branch code not assigned. This code may be shared by different sites. PO and IPO references remain unique.</p>}
   <DirectPoDetailsFields values={values} disabled={busy} onChange={(key,value)=>{setValues(old=>({...old,[key]:value}));setError('');if(key==='ipoNumber')setIpoWarning('');}} onIpoBlur={async()=>{if(!values.ipoNumber?.trim())return;try{const result=await api<any>(`/project-workflow/ipo-number-availability?number=${encodeURIComponent(values.ipoNumber.trim())}`);setIpoWarning(result.available?'':'This IPO number is already in use. Review the existing IPO before continuing.');}catch(e){setIpoWarning((e as Error).message);}}}/>

   {ipoWarning&&<p role="alert" className="form-error">{ipoWarning}</p>}

   <div className="pz-action-row"><Button variant="primary" loading={busy} loadingLabel="Preparing IPO review…" onClick={()=>void prepare()}>Review IPO</Button></div></section>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
