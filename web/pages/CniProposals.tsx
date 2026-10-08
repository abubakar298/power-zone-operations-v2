import { CniFinancialReview } from "../components/CniFinancialReview.js";
import { NewCustomer } from "../components/NewCustomer.js";
import { confirmLeaveWorkspace, useUnsavedChanges } from "../hooks/useUnsavedChanges.js";
import { useEffect, useState } from "react";
import { api, type Session } from "../api.js";
import { confirmTransition } from "../confirm.js";
import { money } from "../numbers.js";
import { priceCni, cniPolicy } from "../../server/commercial/cni-policy.js";
import { displayDate } from "../../server/display/dates.js";
export function CniProposals({session,masters:initialMasters,onBack,onLogout}:{session:Session;masters:any;onBack:()=>void;onLogout:()=>void}) {
 const [masters,setMasters]=useState(initialMasters),[addingCustomer,setAddingCustomer]=useState(false),[dirty,setDirty]=useState(false);
 useUnsavedChanges(dirty);
 const [rows,setRows]=useState<any[]>([]),[detail,setDetail]=useState<any>(),[search,setSearch]=useState("");
 const [customerId,setCustomerId]=useState(""),[siteName,setSiteName]=useState(""),[quantity,setQuantity]=useState("1"),[presentation,setPresentation]=useState<"Inclusive"|"Separate">("Inclusive"),[discount,setDiscount]=useState("0");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[remarks,setRemarks]=useState("");
 const [editing,setEditing]=useState<{id:string;version:number}>();
 const management=["Admin","Management"].includes(session.user.role);
 const load=async()=>setRows((await api<any>("/cni")).proposals);
 useEffect(()=>{load().catch(e=>setError(e.message));},[]);
 let preview:ReturnType<typeof priceCni>|undefined;try{preview=priceCni({quantity:Number(quantity),discount:discount||"0",presentation,taxRate:cniPolicy.taxRate});}catch{}
 const open=async(id:string)=>{setBusy(true);try{setDetail(await api<any>(`/cni/${id}`));setError("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const reset=()=>{if(!confirmLeaveWorkspace())return;setDirty(false);setEditing(undefined);setCustomerId("");setSearch("");setSiteName("");setQuantity("1");setDiscount("0");setDetail(undefined);};
 const current=detail?.versions[0];
 const action=current&&detail.actions.filter((a:any)=>a.version_id===current.id).at(-1)?.action;
 async function review(value:"Approved"|"Revision requested") {
  if(!current||!confirmTransition(value,"This decision applies to the displayed C&I proposal version."))return;
  setBusy(true);setError("");try{await api(`/cni/${detail.id}/review`,{csrf:session.csrfToken,body:{versionId:current.id,action:value,remarks}});await load();setDetail(await api(`/cni/${detail.id}`));setNotice(value);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="boq-section commercial-section">
  <div className="section-heading"><h2>C&amp;I BESS proposals</h2><button onClick={()=>{if(confirmLeaveWorkspace())onBack();}} disabled={busy}>Back to Solar Hybrid BOQ</button></div>
  {addingCustomer&&<NewCustomer session={session} onLogout={onLogout} onClose={()=>setAddingCustomer(false)} onCreated={async id=>{const updated=await api<any>("/masters");setMasters(updated);setCustomerId(String(id));setSearch(updated.customers.find((c:any)=>String(c.id)===String(id))?.name||"");setDirty(true);}}/>}
  {dirty&&<p role="status">Unsaved C&I proposal changes</p>}
  <p>Standard final price: PKR 17,250,000 per cabinet. No separate costing approval is required. Every quotation is sent to Management for approval.</p>
  {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <form className="survey-form" onChange={()=>setDirty(true)} onSubmit={async e=>{e.preventDefault();if(!preview||!customerId)return;if(!confirmTransition("Send quotation for approval","This proposal remains a draft until Management approves it."))return;setBusy(true);setError("");try{const saved=await api<any>("/cni",{csrf:session.csrfToken,body:{customerId:Number(customerId),siteName,quantity:Number(quantity),presentation,discount:discount||"0",...(editing?{proposalId:editing.id,expectedVersion:editing.version}:{})}});setDirty(false);setEditing({id:saved.id,version:saved.version});await load();setDetail(await api(`/cni/${saved.id}`));setNotice("Saved and sent for quotation approval. Draft PDF is ready.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
   <fieldset><legend>{editing?`Revise C&I proposal · V${editing.version}`:"New C&I proposal"}</legend><div className="survey-grid">
    <label>Customer search<input value={search} disabled={!!editing||busy} onChange={e=>{setSearch(e.target.value);setCustomerId("");}} placeholder="Search customer name or phone"/><button type="button" disabled={busy||!!editing} onClick={()=>setAddingCustomer(true)}>Add customer</button>
     {!customerId&&search&&<select aria-label="Select matching customer" value="" onChange={e=>{setCustomerId(e.target.value);setSearch(masters.customers.find((c:any)=>String(c.id)===e.target.value)?.name||"");}}><option value="">Select customer</option>{masters.customers.filter((c:any)=>c.status==="Active"&&`${c.name} ${c.phone}`.toLowerCase().includes(search.toLowerCase())).slice(0,50).map((c:any)=><option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select>}
     {customerId&&<small>Selected: {masters.customers.find((c:any)=>String(c.id)===customerId)?.name}</small>}
    </label>
    <label>Site / Project name<input required maxLength={200} value={siteName} onChange={e=>setSiteName(e.target.value)} disabled={busy}/></label>
    <label>Cabinet quantity<input type="number" min="1" max="1000" step="1" required value={quantity} onChange={e=>setQuantity(e.target.value)} disabled={busy}/><small>{Number(quantity)*125} kW PCS / {Number(quantity)*261} kWh storage</small></label>
    <label>Tax presentation<select value={presentation} onChange={e=>setPresentation(e.target.value as any)} disabled={busy}><option value="Inclusive">Consolidated final price</option><option value="Separate">Separate GST breakdown (18%)</option></select><small>The final payable stays the same in both formats.</small></label>
    <label>Proposed discount amount (PKR)<input type="number" min="0" step="0.01" value={discount} onChange={e=>setDiscount(e.target.value)} disabled={busy}/><small>Any discount needs Management approval. Minimum final price: PKR 15,500,000 per cabinet.</small></label>
   </div></fieldset>
   {preview?<div className="summary-grid"><div className="summary-card">Standard offer<strong>PKR {money(preview.standardPayable)}</strong></div>{presentation==="Separate"&&<><div className="summary-card">Before GST<strong>PKR {money(preview.beforeTax)}</strong></div><div className="summary-card">GST 18%<strong>PKR {money(preview.tax)}</strong></div></>}<div className="summary-card">Final payable<strong>PKR {money(preview.payable)}</strong></div></div>:<p role="alert">Enter valid quantity and discount. The minimum price cannot be breached.</p>}
   <div className="survey-actions"><button type="button" onClick={reset} disabled={busy}>New proposal</button><button className="primary" disabled={busy||!customerId||!preview}>{busy?"Saving…":"Save & send for approval"}</button></div>
  </form>
  <h3>Saved C&amp;I proposals</h3><div className="table-scroll"><table><thead><tr><th>Reference</th><th>Customer / Site</th><th>Quantity</th><th>Payable</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.number}<small>{displayDate(r.created_at)}</small></td><td>{r.snapshot.customer.name}<br/>{r.snapshot.siteName}</td><td>{r.snapshot.pricing.quantity}</td><td>{money(r.snapshot.pricing.payable)}</td><td>{r.action||"Approval requested"}</td><td><button disabled={busy} onClick={()=>open(r.id)}>Open</button></td></tr>)}</tbody></table></div>
  {current&&<section className="detail-panel"><h3>{current.number}</h3><p>{current.snapshot.customer.name} · {current.snapshot.siteName}</p>
   <a href={`/api/cni/${detail.id}/versions/${current.id}/proposal.pdf`} target="_blank" rel="noopener">Open proposal PDF{action!=="Approved"?" (draft)":""}</a>
   <button disabled={busy} onClick={()=>{const s=current.snapshot;setEditing({id:detail.id,version:current.version});setCustomerId(String(s.customer.id));setSearch(s.customer.name);setSiteName(s.siteName);setQuantity(String(s.pricing.quantity));setPresentation(s.pricing.presentation);setDiscount(detail.actions.filter((a:any)=>a.version_id===current.id).at(-1)?.instructions?.recommendedDiscount??s.pricing.discount);setNotice("Original values loaded above. Saving creates a new immutable version.");window.scrollTo({top:0,behavior:"smooth"});}}>Create revision</button>
   {management&&<CniFinancialReview id={detail.id} versionId={current.id} session={session} pending={action==="Approval requested"} onChanged={async()=>{await load();setDetail(await api(`/cni/${detail.id}`));}}/>}
   {management&&action==="Approval requested"&&<div className="revision-request-form"><p>Approval uses the saved quotation price. Send any adjusted price for revision first.</p><label>Review remarks<textarea value={remarks} maxLength={2000} onChange={e=>setRemarks(e.target.value)}/></label><button disabled={busy} onClick={()=>review("Approved")}>Approve quotation</button><button disabled={busy||!remarks.trim()} onClick={()=>review("Revision requested")}>Request revision</button></div>}
   <h4>Document history</h4><ul>{detail.versions.map((v:any)=><li key={v.id}>{v.number} · {displayDate(v.created_at)} · <a href={`/api/cni/${detail.id}/versions/${v.id}/proposal.pdf`} target="_blank" rel="noopener">PDF</a></li>)}</ul>
   <ul>{detail.actions.map((a:any)=><li key={a.id}>{a.action} · {displayDate(a.created_at)} {a.remarks&&`— ${a.remarks}`} {a.instructions?.recommendedDiscount!==undefined&&`· Requested discount PKR ${money(a.instructions.recommendedDiscount)}`}</li>)}</ul>
  </section>}
 </section>;
}
