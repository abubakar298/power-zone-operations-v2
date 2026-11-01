import {useEffect,useState} from 'react';
import {confirmLeaveWorkspace} from '../../hooks/useUnsavedChanges.js';
import {api,type Session} from '../../api.js';
import {Button} from '../../ui/Button.js';
import {decimalDisplay} from '../../numbers.js';
import {Editor,EvidenceLinks,Section,useSave} from './forms.js';
import type {Evidence} from './types.js';
import '../../components/warehouse-movements.css';
import './qc-material-usage.css';
type Line={key:string;itemId:string;description:string;unit:string;issued:string|null;variable:boolean;work?:boolean};
type Row={lineKey:string;issued:string|null;used:string|null;returned:null};
type Root={draftId:string;siteId:string;parent:boolean;kind:string;warehouse:string;references:string[];report:{version:number;snapshot:{date:string;state:string;customerEvidenceId:string|null;internalEvidenceId:string|null;lines:Row[]}}|null;lines:Line[]};
type Data={records:Root[];evidence:{signedDos:Evidence[];variableSignoff:Evidence|null;noVariableItemsUsed:boolean}};
export function QcMaterialUsage({boardId,session}:{boardId:string;session:Session}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Data>(),[error,setError]=useState(''),[rootId,setRootId]=useState(''),[notice,setNotice]=useState('');
 async function load(){setError('');try{const next=await api<Data>('/material-dispatches/qc/sites/'+encodeURIComponent(boardId)+'/material-usage');setData(next);setRootId(v=>next.records.some(r=>r.draftId===v)?v:next.records[0]?.draftId??'');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{setData(undefined);if(open)void load();},[open,boardId]);
 const root=data?.records.find(r=>r.draftId===rootId);
 return <Section title="Material Usage" action={!open?<Button variant="secondary" onClick={()=>setOpen(true)}>Open material usage</Button>:undefined}>
  {!open?<p>Record Operations-confirmed quantities against the signed DO and VSO. Inventory uses the saved figures for its return ledger.</p>:<>
   {notice&&<p role="status" className="ob-success">{notice}</p>}{error&&<><p role="alert" className="form-error">{error}</p><Button variant="neutral" onClick={()=>void load()}>Try again</Button></>}
   {!data?(!error&&<p role="status">Loading issued materials…</p>):!root?<p>No issued material record is linked to this site. Issue or link its DO before recording usage.</p>:<>
    <label>Material dispatch<select value={rootId} onChange={e=>{if(confirmLeaveWorkspace()){setNotice('');setRootId(e.target.value);}}}>{data.records.map(r=><option key={r.draftId} value={r.draftId}>{r.references.join(', ')||'Approved work'} · {r.parent?'Parent DO pool':r.kind==='fixed'?'Individual DO · fixed':'Individual DO · variable'} · {r.warehouse}</option>)}</select></label>
    <UsageForm key={boardId+':'+root.draftId+':'+(root.report?.version??0)} root={root} evidence={data.evidence} boardId={boardId} session={session} onCancel={()=>setOpen(false)} onSaved={()=>{setNotice('Material usage saved for Inventory reconciliation. Warehouse stock is unchanged.');void load();}}/>
   </>}
  </>}
 </Section>;
}
function UsageForm({root,evidence,boardId,session,onCancel,onSaved}:{root:Root;evidence:Data['evidence'];boardId:string;session:Session;onCancel:()=>void;onSaved:()=>void}){
 const initial=root.lines.map(l=>({lineKey:l.key,issued:root.parent?null:l.issued,used:root.report?.snapshot.lines.find(r=>r.lineKey===l.key)?.used??null,returned:null as null}));
 const [rows,setRows]=useState<Row[]>(initial),[date,setDate]=useState(root.report?.snapshot.date??''),[reason,setReason]=useState(''),[fixedConfirmed,setFixedConfirmed]=useState(false);
 const [signedDo,setSignedDo]=useState(root.report?.snapshot.internalEvidenceId??(evidence.signedDos.length===1?evidence.signedDos[0].id:'')),post=useSave(session);
 const fixed=root.lines.filter(l=>!l.variable),variable=root.lines.filter(l=>l.variable),vso=evidence.variableSignoff;
 const invalidVso=!!vso&&evidence.signedDos.some(d=>d.id===vso.id);
 const dirty=reason!==''||date!==(root.report?.snapshot.date??'')||JSON.stringify(rows)!==JSON.stringify(initial)||fixedConfirmed;
 function change(key:string,value:string){setRows(old=>old.map(r=>r.lineKey===key?{...r,used:value===''?null:value}:r));setFixedConfirmed(false);}
 function table(lines:Line[],pooled:boolean){return <div className="pz-table-scroll"><table className="ops-table qc-usage-table"><thead><tr><th>SR#</th><th>Item / description</th><th>UOM</th>{!pooled&&<th>Issued</th>}<th>Used{pooled?' as per signed VSO':''}</th></tr></thead><tbody>{lines.map((l,n)=><tr key={l.key}><td><span className="qc-usage-primary">{n+1}</span></td><td><strong>{l.itemId}</strong><small>{l.description}{l.work?' · Approved work; no warehouse return':''}</small></td><td><span className="qc-usage-primary">{l.unit}</span></td>{!pooled&&<td><span className="qc-usage-primary">{decimalDisplay(l.issued).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')}</span></td>}<td><input aria-label={'Used '+l.itemId} inputMode="decimal" required pattern="[0-9]+([.][0-9]{1,6})?" value={rows.find(r=>r.lineKey===l.key)?.used??''} onChange={e=>change(l.key,e.target.value)}/></td></tr>)}</tbody></table></div>;}
 return <Editor dirty={dirty} busy={post.busy} error={post.error} onCancel={()=>{if(confirmLeaveWorkspace())onCancel();}} label="Verify & Save Material Usage" onSubmit={()=>{
  if(!date||reason.trim().length<3){post.setError('Enter the usage date and a short verification note.');return;}
  if(variable.length&&(invalidVso||!vso&&!evidence.noVariableItemsUsed)){post.setError('Record a distinct signed VSO in Job Completion first.');return;}
  void post.save('/material-dispatches/site-usage',{draftId:root.draftId,siteId:root.siteId,version:root.report?.version??0,workflowVersion:2,date,state:'signed',reason,customerEvidenceId:variable.length&&!invalidVso?vso?.id??null:null,internalEvidenceId:fixed.length?signedDo||null:null,lines:rows},onSaved);
 }}>
  <div className="pz-form-grid"><label>Usage date<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label><label>Verification note<input required minLength={3} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label></div>
  <section className="pz-stack"><h3>Signed documents</h3>
   {!!fixed.length&&<label>Signed DO<select required value={signedDo} onChange={e=>setSignedDo(e.target.value)}><option value="">Choose recorded signed DO</option>{evidence.signedDos.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
   <EvidenceLinks siteId={boardId} files={[...evidence.signedDos,...vso?[vso]:[]]}/>
   {invalidVso&&<p role="alert" className="form-error">The VSO currently points to the same file as a signed DO. Correct the VSO in Job Completion before saving variable usage.</p>}
   {!vso&&variable.length>0&&<p>{evidence.noVariableItemsUsed?'Job Completion confirms no variable items used. Enter zero for every variable item.':'Upload the signed VSO in Job Completion first.'}</p>}
  </section>
  <section className="pz-stack"><h3>Fixed items</h3>{fixed.length?<><label className="ob-check"><input type="checkbox" checked={fixedConfirmed} onChange={e=>{setFixedConfirmed(e.target.checked);if(e.target.checked)setRows(old=>old.map(r=>fixed.some(l=>l.key===r.lineKey)?{...r,used:r.issued}:r));}}/>All fixed items used as issued</label><small>Confirm actual use with Operations. A signed DO proves receipt, not installation.</small>{table(fixed,false)}</>:<p>No fixed items in this dispatch.</p>}</section>
  <section className="pz-stack"><h3>Variable items</h3>{variable.length?<><p>{root.parent?'Parent DO pool: record this site’s usage from its VSO. The pooled issue is not allocated to this site.':'Record the used quantities from this site’s signed VSO against its individual DO.'}</p>{table(variable,root.parent)}</>:<p>No variable items in this dispatch.</p>}</section>
  <p className="pz-caption">Saving records site usage for Inventory. Warehouse counting, return IGPs, stock credits and Parent DO closure happen separately.</p>
 </Editor>;
}
