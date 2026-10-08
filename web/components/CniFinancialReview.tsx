import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { money } from "../numbers.js";
import { confirmDiscountProposal, confirmTransition } from "../confirm.js";
export function CniFinancialReview({id,versionId,session,pending,onChanged}:{id:string;versionId:string;session:Session;pending:boolean;onChanged:()=>Promise<void>}) {
 const [baseline,setBaseline]=useState<any>(),[amount,setAmount]=useState(""),[markup,setMarkup]=useState(""),[amountResult,setAmountResult]=useState<any>(),[markupResult,setMarkupResult]=useState<any>();
 const [notes,setNotes]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [amountError,setAmountError]=useState(""),[markupError,setMarkupError]=useState("");
 useEffect(()=>{let live=true;setBaseline(undefined);setAmount("");setMarkup("");api<any>(`/cni/${id}/financial-review?versionId=${versionId}`).then(r=>{if(live)setBaseline(r);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[id,versionId]);
 useEffect(()=>{let live=true;setAmountResult(undefined);setAmountError("");if(!amount)return;const timer=setTimeout(()=>{api<any>(`/cni/${id}/financial-preview`,{csrf:session.csrfToken,body:{versionId,discount:amount}}).then(r=>{if(live)setAmountResult(r);}).catch(e=>{if(live)setAmountError(e.message);});},200);return()=>{live=false;clearTimeout(timer);};},[amount,id,versionId]);
 useEffect(()=>{let live=true;setMarkupResult(undefined);setMarkupError("");if(!markup)return;const timer=setTimeout(()=>{api<any>(`/cni/${id}/financial-preview`,{csrf:session.csrfToken,body:{versionId,targetMarkup:markup}}).then(r=>{if(live)setMarkupResult(r);}).catch(e=>{if(live)setMarkupError(e.message);});},200);return()=>{live=false;clearTimeout(timer);};},[markup,id,versionId]);
 if(!baseline)return <p role="status">{error||"Loading Management financial review…"}</p>;
 async function sendRevision(){
  if(!notes.trim()){setError("Enter adjustment instructions for Atif.");return;}
  const choices:Array<{key:"discount"|"margin";label:string;discount:string;payable:string}>=[];
  if(amount&&amountResult)choices.push({key:"discount",label:"Discount amount",discount:money(amountResult.recommendedDiscount),payable:money(amountResult.proposed.payable)});
  if(markup&&markupResult)choices.push({key:"margin",label:`Target markup ${markup}%`,discount:money(markupResult.recommendedDiscount),payable:money(markupResult.proposed.payable)});
  let recommendedDiscount:string|undefined;
  if(choices.length){const chosen=await confirmDiscountProposal(choices);if(!chosen)return;recommendedDiscount=(chosen==="discount"?amountResult:markupResult).recommendedDiscount;}
  if(!confirmTransition("Send C&I quotation for revision","Atif will receive your remarks and selected discount instructions, then resubmit for final approval."))return;
  setBusy(true);setError("");try{await api(`/cni/${id}/review`,{csrf:session.csrfToken,body:{versionId,action:"Revision requested",remarks:notes,...(recommendedDiscount!==undefined?{recommendedDiscount}:{})}});await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="detail-panel"><h4>Management financial review</h4><p>Internal cost and markup are visible only to Management/Admin. Profit excludes GST.</p>
  {error&&<p role="alert">{error}</p>}
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,280px),1fr))",gap:16}}>
  {(["amount","markup"] as const).map(kind=>{const value=kind==="amount"?amount:markup,r=(kind==="amount"?amountResult:markupResult)||baseline,failure=kind==="amount"?amountError:markupError;return <div key={kind}>
   <label>{kind==="amount"?"Discount amount (PKR)":"Target markup (%)"}<input type="number" min="0" step="0.01" value={value} onChange={e=>kind==="amount"?setAmount(e.target.value):setMarkup(e.target.value)}/></label>
   {failure?<p role="alert">{failure}</p>:value&&!(kind==="amount"?amountResult:markupResult)?<p role="status">Updating comparison…</p>:<div className="table-scroll"><table><thead><tr><th>Measure</th><th>Quoted / budgeted</th><th>After adjustment</th></tr></thead><tbody>{[["Budgeted cost","cost"],["Budgeted profit","profit"],["Price without GST","beforeTax"],["Applicable GST","tax"],["Payable","payable"],["Discount","discount"],["Markup on cost (%)","markup"]].map(([label,key])=><tr key={key}><th>{label}</th><td>{money(r.original[key])}</td><td>{money(r.proposed[key])}</td></tr>)}</tbody></table></div>}
  </div>;})}
  </div>
  {pending&&<><label>Revision instructions<textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></label><button disabled={busy||!notes.trim()||!!amountError||!!markupError||(!!amount&&!amountResult)||(!!markup&&!markupResult)} onClick={()=>void sendRevision()}>Send for revision</button></>}
 </section>;
}
