import {Field} from '../ui/Field.js';
/** Shared revision-reason module from the original quotation workflow. */
export function RevisionReasonFields({origin,onOrigin,requester,onRequester,reason,onReason,costingChoice,onCostingChoice,allowCommercial=true}:{origin:string;onOrigin:(value:string)=>void;requester:string;onRequester:(value:string)=>void;reason:string;onReason:(value:string)=>void;costingChoice:string;onCostingChoice:(value:string)=>void;allowCommercial?:boolean}){
 return <div className="pz-form-grid pz-revision-reason-fields">
  <Field id="revision-origin" label="Requested by"><select id="revision-origin" aria-label="Revision source" value={origin} onChange={e=>onOrigin(e.target.value)}><option>Internal management</option><option>Customer</option></select></Field>
  <Field id="revision-requester" label="Requester name"><input id="revision-requester" aria-label="Requester name" required maxLength={200} value={requester} onChange={e=>onRequester(e.target.value)}/></Field>
  <div className="pz-field-wide"><Field id="revision-reason" label="Reason"><textarea id="revision-reason" aria-label="Revision reason" required maxLength={2000} value={reason} onChange={e=>onReason(e.target.value)} rows={3}/></Field></div>
  <div className="pz-field-wide"><Field id="revision-costing-choice" label="Does this require costing or technical scope changes?"><select id="revision-costing-choice" aria-label="Requires costing change" required value={costingChoice} onChange={e=>onCostingChoice(e.target.value)}><option value="">Choose revision route</option>{allowCommercial&&<option value="no">No — margins, tax, discount or commercial details only</option>}<option value="yes">Yes — quantities, technical specifications or additional scope</option></select></Field></div>
 </div>;
}
