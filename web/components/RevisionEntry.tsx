import {RevisionPricingSummary} from './RevisionPricingSummary.js';
import {RevisionReasonFields} from './RevisionReasonFields.js';
import {Field} from '../ui/Field.js';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {api,type Session} from '../api.js';
import {Button} from '../ui/Button.js';
import {confirmTransition} from '../confirm.js';

export function RevisionEntry({session,record,onBack,onOpen,children,embedded=false,intent="edit"}:{session:Session;record:any;onBack:()=>void;onOpen?:(task:any)=>void;children?:ReactNode;embedded?:boolean;intent?:"edit"|"return"}){
 const [source,setSource]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[origin,setOrigin]=useState('Internal management'),[reason,setReason]=useState(''),[requester,setRequester]=useState(session.user.displayName),[route,setRoute]=useState(''),[choices,setChoices]=useState<any[]>([]),[frameworkId,setFrameworkId]=useState('');
 const request=useRef<{signature:string;key:string}|null>(null);
 const quoteId=record.quotation?.id??record.sourceQuotationId;
 const frameworkSource=record.customerCode==='UBL'&&record.route==='survey-framework';
 useEffect(()=>{if(frameworkSource)void api<any>(`/project-workflow/${record.id}/configuration-choices`).then(value=>setChoices(value.choices)).catch(e=>setError(e.message));},[record.id]);
 useEffect(()=>{let active=true;if(quoteId&&!frameworkSource)void api<any>(`/commercial/quotations/${quoteId}`).then(value=>{if(active)setSource(value);}).catch(e=>{if(active)setError(e.message);});else if(frameworkSource)void api<any>(`/project-workflow/${record.id}/revision-source`,{csrf:session.csrfToken,body:{}}).then(value=>{if(active)setSource(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[quoteId,record.id,record.version]);
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!source||!route||busy)return;
  if(!confirmTransition(intent==='return'?'Return to Atif for Revision':'Create document revision',intent==='return'?'The quotation will enter the Coordinator revision queue with this reason. Saved documents and amounts remain unchanged.':'A separate revision will be created. The source BOQ, quotation and approved financial snapshots remain unchanged.'))return;
  const body={intent,sourceQuotationId:source.id,origin,costingChange:route==='technical',reason,requestedBy:requester};const signature=JSON.stringify({...body,frameworkId});if(request.current?.signature!==signature)request.current={signature,key:crypto.randomUUID()};
  setBusy(true);setError('');try{const result=await api<any>(frameworkSource?`/project-workflow/${record.id}/framework-revision`:'/commercial/revision-requests',{csrf:session.csrfToken,body:frameworkSource?{sourceId:source.id,frameworkId,route,origin,reason,requestedBy:requester,requestKey:request.current!.key}:{...body,requestKey:request.current!.key}});
   if(intent==='return'){onBack();window.dispatchEvent(new Event('pz:workspace-open'));window.dispatchEvent(new CustomEvent('pz:workflow-completed',{detail:{message:'Returned to Atif for revision.'}}));return;}
   if(frameworkSource)onOpen?.({target:'pricing',boq_revision_id:result.boq_revision_id,context:{frameworkPricingInput:result.pricingInput},kind:'Pre-agreed configuration revision',id:result.id});
   else if(route==='technical')onOpen?.({target:'boqs',draft_id:result.draft_id,kind:'BOQ revision',id:result.draft_id});
   else onOpen?.({target:'pricing',boq_revision_id:source.boq_revision_id,request_id:frameworkSource?undefined:result.id,context:frameworkSource?{frameworkPricingInput:source.pricingInput}:undefined,kind:'Commercial revision',id:result.id});
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="pz-panel pz-stack">{!embedded&&<div className="pz-action-row"><Button variant="neutral" onClick={onBack}>Back to Revisions</Button></div>}<h2>{intent==='return'?'Return to Atif for Revision':'Create Revision'}</h2>
  <p>{record.customerCode??''} · {record.site??record.number??''}{record.siteCode?` (${record.siteCode})`:''}</p>
  {children}
  <RevisionPricingSummary session={session} source={source}/>
  <form onSubmit={submit} className="pz-stack pz-revision-entry-form">
  <h3>Revision request</h3>
  <fieldset disabled={busy} className="pz-revision-controls pz-stack">
   <div className="pz-form-grid">
    <Field id="revision-source-document" label="Source document"><input id="revision-source-document" readOnly value={source?.number??record.number??(record.data?.ublSurveyPackageId?'UBL survey package':'Survey / recommendation')}/></Field>
    <Field id="revision-source-boq" label="Source BOQ" hint="Fixed for this revision."><input id="revision-source-boq" aria-label="Source BOQ" readOnly value={source?.snapshot?.boqNumber??(frameworkSource?source?.number:undefined)??source?.boq_revision_id??'Not yet created for this survey'}/></Field>
   </div>
   <RevisionReasonFields allowCommercial={!frameworkSource} origin={origin} onOrigin={setOrigin} requester={requester} onRequester={setRequester} reason={reason} onReason={setReason} costingChoice={route==='technical'?'yes':route==='commercial'?'no':''} onCostingChoice={value=>setRoute(value==='yes'?'technical':value==='no'?'commercial':'')}/>
   {frameworkSource&&<Field id="ubl-revision-configuration" label="Approved Solution ID" hint="Only final approved configurations are available. The fixed agreed price follows this selection."><select id="ubl-revision-configuration" value={frameworkId} required onChange={e=>{setFrameworkId(e.target.value);setRoute('technical');}}><option value="">Select configuration</option>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.configuration_key.split(':')[0]}</option>)}</select></Field>}
  </fieldset>
  {route&&<p>{frameworkSource?'Continue with the selected configuration and fixed agreed prices.':route==='technical'?'Continue to Revise BOQ with saved quantities, solution and allocated brands.':'Continue to Quotation Settings, retaining the existing BOQ and costing.'}</p>}
  {!quoteId&&!frameworkSource&&<p className="form-error">This survey package has no saved BOQ or quotation yet. A source BOQ is required before a BOQ or commercial revision can be created.</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="pz-action-row"><Button type="submit" variant="primary" loading={busy} disabled={!source||!route||(frameworkSource&&!frameworkId)}>{intent==='return'?'Return to Atif for Revision':'Continue Revision'}</Button></div>{frameworkSource&&<div className="pz-action-row"><Button variant="secondary" disabled={busy||!reason.trim()} onClick={async()=>{if(!confirmTransition('Return survey corrections to Design','The Excel survey inputs will be corrected by Design. The approved configuration and historical prices remain preserved.'))return;setBusy(true);setError('');try{await api(`/project-workflow/${record.id}/actions`,{csrf:session.csrfToken,body:{version:record.version,requestKey:crypto.randomUUID(),action:'technical-return',input:{notes:reason,category:'Internal correction',excelCorrection:true}}});onBack();window.dispatchEvent(new Event('pz:workspace-open'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Return Survey Corrections to Design</Button></div>}</form>
 </section>;
}
