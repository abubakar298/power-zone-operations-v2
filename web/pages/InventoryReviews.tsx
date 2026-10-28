import {StandaloneClosingReviews} from '../components/StandaloneClosingReviews.js';
import {InventoryNavigation} from '../components/InventoryNavigation.js';
import {useEffect,useState,useRef} from 'react';
import {Decimal} from 'decimal.js';
import {api,type Session} from '../api.js';
import {Brand} from '../components/Brand.js';
import {Icon} from '../components/Icon.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {useUnsavedChanges,confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import type {prepareInventoryReview} from '../../server/inventory/review-source.js';
import type {WarehouseSourceRepository} from '../../server/inventory/warehouse-register.js';
import './operations-board/operations-board.css';

type Source=ReturnType<typeof prepareInventoryReview>['cases'][number]&{calculationHolds?:string[]};
type Proposal={treatment:string;explanation:string;evidence:{reference:string;description:string}[];returnCorrection?:{sourceSha256:string;ledgerKey:string;ledgerRevision:number;inDelta:string}};
type Row={id:string;source_row:Source;version:number;state:string;proposal:Proposal|null;reason:string};
type Register={access:{reviewer:boolean;approver:boolean};rows:Row[];postingEnabled:boolean};
type Detail=Row&{closing:Awaited<ReturnType<WarehouseSourceRepository['caseClosing']>>;history:{version:number;state:string;reason:string;created_at:string;proposal:Proposal|null}[]};
const labels:Record<string,string>={'source-verified':'Verified','needs-review':'Needs review',proposed:'Awaiting approval',clarification:'Clarification needed','approved-awaiting-posting':'Approved · posting held',posted:'Correction posted'};
const quantityLabels:Record<keyof Source['quantities'],string>={dispatch:'DO out',irrIssued:'IRR issued',used:'Used',reportedReturn:'IRR reported return',countedReturn:'Counted return',expectedReturn:'DO less used',warehouseReturn:'Accepted warehouse return',credited:'Already credited',returnDifference:'Return difference',creditDifference:'Credit difference'};
export function InventoryReviews({session,onLogout,reviewScope,mode="closing"}:{session:Session;onLogout:()=>void;mode?:"closing"|"parent";reviewScope?:{caseKeys:string[];title:string}}){
 const reviewBase=mode==='parent'?'/inventory/parent-dos/review':'/inventory/reconciliations';
 const [data,setData]=useState<Register>(),[detail,setDetail]=useState<Detail>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[filter,setFilter]=useState('review'),[warehouse,setWarehouse]=useState(''),[mobile,setMobile]=useState(false),[page,setPage]=useState(0);
 async function load(){setError('');try{setData(await api<Register>('/inventory-reviews'));}catch(e){setError((e as Error).message);}}
 const currentPath=useRef(location.pathname+location.search);
 const routeItem=()=>location.pathname.slice(reviewBase.length).match(/^\/([a-f0-9]{64})\/?$/)?.[1];
 useEffect(()=>{void load();const id=routeItem();if(id)void open(id,false);
  const pop=()=>{if(!confirmLeaveWorkspace()){history.pushState(null,'',currentPath.current);return;}currentPath.current=location.pathname+location.search;const next=routeItem();if(next)void open(next,false,false);else setDetail(undefined);};
  window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);
 },[]);
 useEffect(()=>{setPage(0);},[filter,warehouse,search]);
 async function open(id:string,navigate=true,checkChanges=true){if(checkChanges&&!confirmLeaveWorkspace())return;setBusy(true);setError('');try{setDetail(await api<Detail>('/inventory-reviews/'+id));setNotice('');if(navigate){const path=reviewBase+'/'+id;history.pushState(null,'',path);currentPath.current=path;}window.scrollTo(0,0);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function back(){if(!confirmLeaveWorkspace())return;setDetail(undefined);history.pushState(null,'',reviewBase);currentPath.current=reviewBase;window.scrollTo(0,0);}
 const rows=(data?.rows??[]).filter(r=>(mode==='parent'?r.source_row.sourceRow.reviewKind!=='standalone-closing':String(r.source_row.sourceRowId).startsWith('closing-check:'))&&(!reviewScope||reviewScope.caseKeys.includes(r.source_row.groupId+':'+r.source_row.sourceRowId))&&(!warehouse||r.source_row.warehouse===warehouse)&&(filter==='all'||filter==='review'&&!['source-verified','approved-awaiting-posting','posted'].includes(r.state)||filter==='verified'&&r.state==='source-verified'||filter===r.state)&&`${r.source_row.item??''} ${r.source_row.description} ${r.source_row.groupTitle}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>Number(a.state==='source-verified')-Number(b.state==='source-verified')||a.source_row.groupTitle.localeCompare(b.source_row.groupTitle)||a.source_row.description.localeCompare(b.source_row.description));
 return <div className="ob-shell">
  <header className="ob-header"><Button className="ob-mobile-toggle" aria-label="Open navigation" onClick={()=>setMobile(!mobile)}><Icon name="menu"/></Button><Brand compact/><div className="ob-header-identity"><strong>{session.user.displayName}</strong><small>{session.user.role}</small></div><Button onClick={async()=>{if(!confirmLeaveWorkspace())return;try{await api('/auth/logout',{csrf:session.csrfToken,body:{}});onLogout();}catch(e){setError((e as Error).message);}}}>Sign out</Button></header>
  <InventoryNavigation mode="dispatcher" active={mode==='parent'?'parent-dos':'reconciliations'} mobile={mobile}/>
  <main className="ob-main">
   <div className="ob-page-title"><div><h1>{reviewScope?.title??(mode==='parent'?'Parent DO reconciliation':'Closing reconciliations')}</h1><p>Review differences and preserve verified conclusions.</p></div><Button loading={busy} onClick={()=>{if(detail)void open(detail.id,false);else if(confirmLeaveWorkspace())void load();}}>Refresh</Button></div>
   {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="ob-success" role="status">{notice}</p>}
   {data&&!detail&&mode!=='parent'&&<StandaloneClosingReviews reviewRows={data.rows} busy={busy} onReview={id=>void open(id)}/>}
   {data&&!detail&&<section className="pz-panel pz-stack">
    <div className="ob-search-row"><label className="pz-field">{reviewScope?'Search item or correction':'Search item or batch'}<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="pz-field">Warehouse<select value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">All warehouses</option>{[...new Set(data.rows.map(r=>r.source_row.warehouse))].sort().map(w=><option key={w}>{w}</option>)}</select></label><label className="pz-field">Show<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="review">Needs attention</option><option value="proposed">Awaiting approval</option><option value="approved-awaiting-posting">Approved · posting held</option><option value="posted">Posted corrections</option><option value="verified">Verified</option><option value="all">All items</option></select></label></div>
    <div className="ob-section-title"><p>{rows.length} items</p><div className="ob-actions"><Button disabled={page===0} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page+1} of {Math.max(1,Math.ceil(rows.length/50))}</span><Button disabled={(page+1)*50>=rows.length} onClick={()=>setPage(page+1)}>Next</Button></div></div><div className="pz-table-scroll">{reviewScope?<ClosingCorrectionTable rows={rows.slice(page*50,(page+1)*50)} busy={busy} onOpen={id=>void open(id)}/>:<table className="ob-table"><thead><tr><th>Item</th><th>Batch / warehouse</th><th>DO out</th><th>Used</th><th>Return difference</th><th>Credit difference</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.slice(page*50,(page+1)*50).map(r=><tr key={r.id}><td><strong>{r.source_row.item??'Item ID needs review'}</strong><small>{r.source_row.description}</small></td><td><strong>{r.source_row.groupTitle}</strong><small>{r.source_row.warehouse}</small></td><td>{r.source_row.quantities.dispatch??'Unknown'}<small>{r.source_row.unit}</small></td><td>{r.source_row.quantities.used??'Unknown'}</td><td>{r.source_row.quantities.returnDifference??'Unknown'}</td><td>{r.source_row.quantities.creditDifference??'Unknown'}</td><td><StatusBadge tone={['source-verified','posted'].includes(r.state)?'success':'warning'}>{labels[r.state]}</StatusBadge></td><td><Button variant="secondary" disabled={busy} onClick={()=>void open(r.id)}>Review</Button></td></tr>)}</tbody></table>}</div>{!rows.length&&<p>No items match these filters.</p>}
   </section>}
   {detail&&data&&<ReviewDetail closingOnly={mode!=='parent'} key={detail.id+':'+detail.version} detail={detail} access={data.access} session={session} onBack={back} onSaved={async()=>{const updated=await api<Detail>('/inventory-reviews/'+detail.id);setDetail(updated);await load();setNotice(updated.state==='posted'?'Approved return correction recorded once in the warehouse reconciliation ledger.':'Decision saved. No stock correction posted.');}}/>}
   {!data&&!error&&<p role="status">Loading reconciliations…</p>}
  </main>
 </div>;
}
function ClosingCorrectionTable({rows,busy,onOpen}:{rows:Row[];busy:boolean;onOpen:(id:string)=>void}){
 return <table className="ob-table"><thead><tr><th>Item</th><th>Warehouse</th><th>Ledger correction</th><th>Proposed adjustment</th><th>Decision status</th><th>Action</th></tr></thead><tbody>{rows.map(r=>{
 const checks=Array.isArray(r.source_row.sourceRow.closingChecks)?r.source_row.sourceRow.closingChecks as {title:string;detail:string;proposedClosingDelta:number|null}[]:[];
 const changes=checks.filter(c=>c.proposedClosingDelta!==null);
 return <tr key={r.id}><td><strong>{r.source_row.item??'Item ID needs review'}</strong><small>{r.source_row.description}</small></td><td><strong>{r.source_row.warehouse}</strong></td><td><strong>Return-credit correction</strong><small>{changes.map(c=>c.title).join('; ')}</small><a href={'/inventory/parent-dos/review?group='+encodeURIComponent(r.source_row.groupId)}>View source Parent DO</a></td><td><strong>{changes.map(c=>{const n=new Decimal(c.proposedClosingDelta!);return (n.gt(0)?'+':'')+n.toDecimalPlaces(2).toFixed()+' '+r.source_row.unit;}).join('; ')}</strong></td><td><StatusBadge tone={r.state==='posted'?'success':'warning'}>{labels[r.state]}</StatusBadge></td><td><Button variant="secondary" disabled={busy} onClick={()=>onOpen(r.id)}>Review correction</Button></td></tr>;
 })}</tbody></table>;
}

function ReviewDetail({detail,access,session,onBack,onSaved,closingOnly=false}:{closingOnly?:boolean;detail:Detail;access:Register['access'];session:Session;onBack:()=>void;onSaved:()=>Promise<void>}){
 const initial=detail.state==='clarification'?detail.proposal:null;
 const [reason,setReason]=useState(''),[explanation,setExplanation]=useState(initial?.explanation??''),[reference,setReference]=useState(initial?.evidence[0]?.reference??''),[description,setDescription]=useState(initial?.evidence[0]?.description??''),[treatment,setTreatment]=useState(initial?.treatment??'correct-source-record'),[includeCredit,setIncludeCredit]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useUnsavedChanges(!!(reason||includeCredit||explanation!==(initial?.explanation??'')||reference!==(initial?.evidence[0]?.reference??'')||description!==(initial?.evidence[0]?.description??''))); 
 const row=detail.source_row,canPropose=access.reviewer&&['needs-review','clarification'].includes(detail.state),canDecide=access.approver&&detail.state==='proposed',canClarify=access.approver&&detail.state==='approved-awaiting-posting';
 const standalone=row.sourceRow.reviewKind==='standalone-closing';
 const closing=detail.closing;
 const closingChecks=Array.isArray(row.sourceRow.closingChecks)?row.sourceRow.closingChecks as {id:string;title:string;detail:string;status:string;proposedClosingDelta:number|null}[]:[];
 // Prefer the shared ledger projection. Older read responses expose its exact components.
 const currentIn=closing.available?closing.totalIn??new Decimal(closing.balance.eventIn).plus(closing.postedReturnCorrections).plus(closing.operationalIn).toString():null;
 const currentOut=closing.available?closing.totalOut??new Decimal(closing.balance.eventOut).plus(closing.operationalOut).toString():null;
 const creditAvailable=closing.available&&!closing.caseCorrectionPosted&&!closing.holds.length&&closing.currentClosing!==null&&closing.suggestedReturnCorrection&&closing.suggestedReturnCorrection.inDelta!=='0';
 const requestIdentity=useRef<{signature:string;key:string}|null>(null);
 async function save(action:string){
  setBusy(true);setError('');
  const returnCorrection=includeCredit&&closing.available&&closing.suggestedReturnCorrection?{
   sourceSha256:closing.sourceSha256,ledgerKey:closing.ledgerKey,ledgerRevision:closing.ledgerRevision,inDelta:closing.suggestedReturnCorrection.inDelta,
  }:undefined;
  const body={version:detail.version,action,reason,...action==='propose'?{proposal:{
   treatment,explanation,evidence:[{reference,description}],...returnCorrection?{returnCorrection}:{},
  }}:{}};
  const signature=JSON.stringify(body);
  if(requestIdentity.current?.signature!==signature)requestIdentity.current={signature,key:crypto.randomUUID()};
  try{
   await api('/inventory-reviews/'+detail.id+'/decisions',{csrf:session.csrfToken,body:{...body,requestKey:requestIdentity.current.key}});
   await onSaved();
   requestIdentity.current=null;
   setReason('');setExplanation('');setReference('');setDescription('');setIncludeCredit(false);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }

 return <>
  <Button className="ob-back" onClick={onBack}>Back to reconciliations</Button>
  <section className="pz-panel pz-stack"><div><h2>{row.item??'Final item ID needs review'}</h2><p>{row.description}</p></div><div className="ob-facts"><div><span>{closingOnly?'Source reference':'Batch'}</span>{standalone?<a href={String(row.sourceRow.sourceUrl??'')} target="_blank" rel="noreferrer">View source sheet</a>:closingOnly?<a href={'/inventory/parent-dos/review?group='+encodeURIComponent(row.groupId)}>View source Parent DO</a>:<strong>{row.groupTitle}</strong>}</div><div><span>Warehouse</span><strong>{row.warehouse}</strong></div><div><span>Origin</span><strong>{row.origin==='warehouse_stock'?'Warehouse stock':row.origin==='LP'?'Local purchase':row.origin}</strong></div><div><span>Decision</span><strong>{labels[detail.state]}</strong></div></div>
   {!standalone&&<div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Quantity</th><th>Value</th><th>Unit</th></tr></thead><tbody>{(closingOnly?['credited','warehouseReturn','creditDifference'] as (keyof Source['quantities'])[]:Object.keys(quantityLabels) as (keyof Source['quantities'])[]).map(key=><tr key={key}><td>{quantityLabels[key as keyof Source['quantities']]}</td><td>{row.quantities[key]??'Unknown'}</td><td>{row.unit}</td></tr>)}</tbody></table></div>}
   <p>Source conclusion: {row.sourceStatus}</p>{row.calculationHolds?.map(hold=><p key={hold}>{hold}</p>)}{row.stockPosting==='already-recorded-in-source'&&<p>Earlier stock correction retained. It will not be posted again.</p>}
   {!closingOnly&&!standalone&&<SourceEvidence source={row.sourceRow}/>}
  </section>
  {!!closingChecks.length&&<section className="pz-panel pz-stack"><h2>Ledger correction to review</h2><p>Original material conclusion: {String(row.sourceRow.originalSourceStatus??row.sourceStatus)}. The closing decision below is separate.</p>{closingChecks.map(check=><article key={check.id}><strong>{check.title}</strong><p>{check.detail}</p><small>{check.status}{check.proposedClosingDelta!==null?` · Proposed adjustment: ${new Decimal(check.proposedClosingDelta).toDecimalPlaces(2).toFixed()} ${row.unit}`:' · Amount requires verification'}</small></article>)}</section>}
  {standalone&&<section className="pz-panel pz-stack"><h2>Source check</h2><p>{String(row.sourceRow.site??'')} · {String(row.sourceRow.ipo??'')}</p><p>{String(row.sourceRow.expectedAction??'')}</p><p>Source quantity: {row.sourceRow.sourceQuantity==null?'Not supplied':String(row.sourceRow.sourceQuantity)} {String(row.sourceRow.sourceUnit??'')}</p><p>{String(row.sourceRow.reason??'')}</p><a href={String(row.sourceRow.sheetUrl??'')} target="_blank" rel="noreferrer">View original sheet row</a><p>This reference check does not establish a warehouse receipt or stock adjustment.</p></section>}
  {!standalone&&<section className="pz-panel pz-stack"><h2>Closing-stock preview</h2>{!detail.closing.available?<p>{detail.closing.reason}</p>:<>
   <p>{detail.closing.warehouse} · {detail.closing.unit}</p>
   <div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Balance</th><th>Opening</th><th>IN</th><th>OUT</th><th>Closing</th></tr></thead><tbody>
    <tr><td><strong>Source baseline</strong><small>{detail.closing.balance.review} · {detail.closing.balance.openingStatus}</small></td><td>{detail.closing.balance.opening??'Unknown'}</td><td>{detail.closing.balance.eventIn}</td><td>{detail.closing.balance.eventOut}</td><td>{detail.closing.balance.calculatedClosing??'Unknown'}</td></tr>
    <tr><td><strong>Current reconciliation</strong><small>Approved return IN: {detail.closing.postedReturnCorrections} {detail.closing.unit}</small></td><td>{detail.closing.balance.opening??'Unknown'}</td><td>{currentIn}</td><td>{currentOut}</td><td>{detail.closing.currentClosing??'Unknown'}</td></tr>
    {detail.closing.suggestedReturnCorrection&&detail.closing.suggestedReturnCorrection.inDelta!=='0'&&<tr><td><strong>After proposed correction</strong><small>Additional return IN: {detail.closing.suggestedReturnCorrection.inDelta} {detail.closing.unit}</small></td><td>{detail.closing.balance.opening??'Unknown'}</td><td>{new Decimal(currentIn!).plus(detail.closing.suggestedReturnCorrection.inDelta).toString()}</td><td>{currentOut}</td><td>{detail.closing.suggestedReturnCorrection.after??'Unknown'}</td></tr>}
   </tbody></table></div>
   {detail.closing.balance.precisionResidue&&<p>The original export has a floating-point residue below 0.000001. This comparison uses exact movement totals; the original values remain preserved.</p>}
   {detail.closing.suggestedReturnCorrection?.inDelta==='0'?<p>No additional return credit due.</p>:!detail.closing.suggestedReturnCorrection&&<p>Return-credit effect cannot be calculated from the current evidence.</p>}
   {detail.closing.holds.map(hold=><p key={hold}>{hold}</p>)}<p>This preview does not post stock or replace a current physical count.</p>
  </>}</section>}
  {detail.proposal&&<section className="pz-panel pz-stack"><h2>Inventory proposal</h2><p>{detail.proposal.explanation}</p>{detail.proposal.evidence.map((e,i)=><div key={i}><strong>{e.reference}</strong><p>{e.description}</p></div>)}</section>}
  {(canPropose||canDecide||canClarify)&&<form className="pz-panel ob-editor pz-stack" onSubmit={e=>{e.preventDefault();void save(canPropose?'propose':canClarify?'return-for-clarification':'approve');}}><h2>{canPropose?'Propose a decision':canClarify?'Request clarification':'Management decision'}</h2><fieldset disabled={busy}>
   {canPropose&&<><label>Treatment<select value={treatment} onChange={e=>{setTreatment(e.target.value);if(e.target.value!=='verify-return')setIncludeCredit(false);}}>{[['correct-source-record','Correct source record'],['verify-return','Verify return'],['investigate-shortage','Investigate shortage'],['resolve-identity','Resolve item identity'],['other','Other']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Proposed decision<textarea required maxLength={4000} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label><label>Evidence reference<input required maxLength={1000} value={reference} onChange={e=>setReference(e.target.value)}/></label><label>What the evidence confirms<textarea required maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label></>}
   <label>Reason<textarea required maxLength={4000} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="form-error">{error}</p>}
   {canPropose&&creditAvailable&&<label className="ob-check"><input type="checkbox" checked={includeCredit} onChange={e=>{setIncludeCredit(e.target.checked);if(e.target.checked)setTreatment('verify-return');}}/>Include the calculated return-credit correction for Management approval</label>}
   {canDecide&&<p>{detail.proposal?.returnCorrection?'Approval records the linked return correction once in the warehouse reconciliation ledger. Original receipts remain intact.':'Approval retains this decision. Stock posting remains held until its separate correction is supported.'}</p>}
   <div className="ob-actions"><Button type="submit" variant="primary" loading={busy} disabled={canDecide&&row.identityReviewRequired}>{canPropose?'Send for approval':canClarify?'Return for clarification':detail.proposal?.returnCorrection?'Approve return correction':'Approve decision'}</Button>{canDecide&&<Button disabled={busy||!reason.trim()} onClick={()=>void save('return-for-clarification')}>Return for clarification</Button>}</div>
  </fieldset></form>}
  <section className="pz-panel pz-stack"><h2>Decision history</h2>{detail.history.map(h=><div className="ob-history" key={h.version}><strong>Version {h.version} · {labels[h.state]}</strong><p>{h.reason}</p><small>{new Date(h.created_at).toLocaleString()}</small></div>)}</section>
 </>;
}
function SourceEvidence({source}:{source:Source['sourceRow']}){
 const records=(value:unknown)=>Array.isArray(value)?value.filter((v):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)):[];
 const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value):'Unknown';
 function link(value:unknown){if(typeof value!=='string')return null;try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)?<a href={url.href} target="_blank" rel="noreferrer">Open source</a>:null;}catch{return null;}}
 const allocations=records(source.allocations),evidence=records(source.evidence),notes=Array.isArray(source.notes)?source.notes.filter((v):v is string=>typeof v==='string'):[];
 return <details><summary>Source evidence and site allocations</summary><div className="pz-stack">
  {!!allocations.length&&<div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>Site / IPO</th><th>DO</th><th>IRR issued</th><th>Used</th><th>IRR return</th><th>Evidence</th></tr></thead><tbody>{allocations.map((a,i)=><tr key={i}><td><strong>{text(a.site)}</strong><small>{text(a.ipo)}</small></td><td>{text(a.doQty)}</td><td>{text(a.irrIssued)}</td><td>{text(a.used)}</td><td>{text(a.reportedReturn)}</td><td>{link(a.source)??'Reference not recorded'}</td></tr>)}</tbody></table></div>}
  {!!evidence.length&&<div className="pz-table-scroll"><table className="ob-table"><thead><tr><th>IPO</th><th>Previously recorded receipt</th><th>Unit</th><th>Evidence</th></tr></thead><tbody>{evidence.map((e,i)=><tr key={i}><td>{text(e.ipo)}</td><td>{text(e.quantity_in_source_unit)}</td><td>{text(e.unit)}</td><td>{link(e.source_IRR)??'Reference not recorded'}</td></tr>)}</tbody></table></div>}
  {notes.map((note,i)=><p key={i}>{note}</p>)}
  {!allocations.length&&!evidence.length&&!notes.length&&<p>No additional source evidence recorded.</p>}
 </div></details>;
}
