import {directPoFields} from '../../shared/direct-po-reading.js';
import {Field} from '../ui/Field.js';
const displayOrder=['ipoNumber','orderNumber','siteCode','siteName','siteContact','sitePhone','siteAddress','approvalContact','approvalEmail','approvalDate','approvalSubject','contactPerson','phone','email','billingAddress','paymentContact','paymentPhone'];
const wideFields=new Set(['siteAddress','billingAddress','email']);
/** Same aligned controls for the first evidence reading and subsequent record edits. */
export function DirectPoDetailsFields({values,onChange,disabled=false,onIpoBlur,prefix='direct-po'}:{values:Record<string,string>;onChange:(key:string,value:string)=>void;disabled?:boolean;onIpoBlur?:()=>void|Promise<void>;prefix?:string}){
 return <fieldset disabled={disabled} className="pz-form-grid pz-direct-po-fields">{displayOrder.map(key=>{
  const label=directPoFields.find(([field])=>field===key)![1],id=`${prefix}-${key}`;
  const hint=key==='orderNumber'?'For example 20/60 — unit 20 from the 60-unit order':key==='siteAddress'?'Installation address; separate from the customer billing address.':undefined;
  return <Field key={key} id={id} label={label} hint={hint}><input id={id} aria-describedby={hint?`${id}-hint`:undefined} data-wide={wideFields.has(key)||undefined} type={key==='approvalDate'?'date':key==='email'||key==='approvalEmail'?'email':'text'} maxLength={key==='billingAddress'||key==='siteAddress'?1000:200} value={values[key]??''} onChange={e=>onChange(key,e.target.value)} onBlur={key==='ipoNumber'?onIpoBlur:undefined}/></Field>;
 })}</fieldset>;
}
