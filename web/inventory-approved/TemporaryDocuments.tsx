import {ListPagination,paginateRows,useListPage} from '../ui/ListPagination.js';
import {useUnsavedChanges,confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import React,{useEffect,useMemo,useState,useRef}from'react';
import {api,type Session} from '../api.js';
import './temporary.css';
import {Button} from '../ui/Button.js';
import {Field} from '../ui/Field.js';
import {StatusBadge} from '../ui/StatusBadge.js';
import {DocumentPreview} from '../components/DocumentPreview.js';

type TemporaryType='IGP'|'OGP'|'TRF'|'IRR'|'OTHER';
type TemporaryLine={itemId:string;description:string;quantity:string;unit:string;remarks:string};
type TemporaryDocument={version?:number;id:string;number:string;type:TemporaryType;createdAt:string;date:string;warehouse:string;party:string;sourceReference:string;actualReference:string;notes:string;lines:TemporaryLine[];detailsConfirmed:boolean};
const types:{id:TemporaryType;label:string;title:string}[]=[
 {id:'IGP',label:'IGP · Purchase inward',title:'Inwards Gate Pass'},
 {id:'OGP',label:'OGP · Material issue / site delivery',title:'Outwards Gate Pass'},
 {id:'TRF',label:'TRF · Warehouse transfer',title:'Stock Transfer'},
 {id:'IRR',label:'IRR · Site material return',title:'Inventory Return Record'},
 {id:'OTHER',label:'Other inventory document',title:'Inventory Document'}
];
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const blankLine=():TemporaryLine=>({itemId:'',description:'',quantity:'',unit:'',remarks:''});
const emptyDraft=():TemporaryDocument=>({id:'',number:'',type:'IGP',createdAt:'',date:today(),warehouse:'',party:'',sourceReference:'',actualReference:'',notes:'',lines:[blankLine(),blankLine(),blankLine()],detailsConfirmed:false});
function titleOf(type:TemporaryType){return types.find(t=>t.id===type)?.title||'Inventory Document';}

export function TemporaryDocuments({initialCreate=false,session}:{initialCreate?:boolean;session:Session}){
 const[documents,setDocuments]=useState<TemporaryDocument[]>([]);
 const[draft,setDraft]=useState<TemporaryDocument|null>(()=>initialCreate?emptyDraft():null);
 const[printing,setPrinting]=useState<TemporaryDocument|null>(null);
 const[notice,setNotice]=useState('');
 const [locations,setLocations]=useState<string[]>([]),[stockItems,setStockItems]=useState<{id:string;description:string;unit:string}[]>([]),[busy,setBusy]=useState(false);const request=useRef<{signature:string;key:string}|null>(null);
 useEffect(()=>{void api<{documents:TemporaryDocument[];warehouses:string[];items:typeof stockItems}>('/material-dispatches/temporary-documents').then(data=>{setDocuments(data.documents);setLocations(data.warehouses);setStockItems(data.items);}).catch(e=>setNotice(e.message));},[]);
 useEffect(()=>{window.scrollTo(0,0);},[Boolean(draft),Boolean(printing)]);
 const pending=useMemo(()=>documents.filter(d=>!d.detailsConfirmed),[documents]);
 const [search,setSearch]=useState(''),[status,setStatus]=useState('all');
 const [page,setPage]=useListPage(search+'|'+status);
 const filtered=documents.filter(d=>(status==='all'||(status==='pending'?!d.detailsConfirmed:d.detailsConfirmed))&&[d.number,d.party,d.warehouse,d.sourceReference,d.actualReference,d.type].join(' ').toLowerCase().includes(search.toLowerCase()));
 const pagination=paginateRows(filtered,page),visible=pagination.rows;

 const startNew=()=>{setPrinting(null);setNotice('');setDraft(emptyDraft());};
 const edit=(doc:TemporaryDocument)=>{setPrinting(null);setNotice('');setDraft({...doc,lines:doc.lines.map(line=>({...line}))});};
 const change=(key:keyof TemporaryDocument,value:unknown)=>setDraft(current=>current?{...current,[key]:value}:current);
 const updateLine=(index:number,key:keyof TemporaryLine,value:string)=>setDraft(current=>{if(!current)return current;const lines=current.lines.map((line,i)=>i===index?{...line,[key]:value}:line);if(key==='itemId'){const item=stockItems.find(row=>row.id===value);if(item)lines[index]={...lines[index],description:item.description,unit:item.unit||''};}return{...current,lines};});
 const changed=!!draft&&(draft.id?JSON.stringify(draft)!==JSON.stringify(documents.find(d=>d.id===draft.id)):!!(draft.warehouse||draft.party||draft.sourceReference||draft.actualReference||draft.notes||draft.detailsConfirmed||draft.lines.some(l=>l.itemId||l.description||l.quantity||l.unit||l.remarks)));
 useUnsavedChanges(changed||busy);
 const save=async()=>{if(!draft||busy)return;if(!draft.date||!draft.warehouse){setNotice('Choose a document date and warehouse before saving.');return;}setBusy(true);setNotice('');try{const body={id:draft.id,version:draft.version??0,type:draft.type,date:draft.date,warehouse:draft.warehouse,party:draft.party,sourceReference:draft.sourceReference,actualReference:draft.actualReference,notes:draft.notes,detailsConfirmed:draft.detailsConfirmed,lines:draft.lines.filter(line=>line.itemId||line.description||line.quantity||line.remarks)};if(!body.lines.length)body.lines=[blankLine()];const signature=JSON.stringify(body);if(request.current?.signature!==signature)request.current={signature,key:crypto.randomUUID()};const saved=await api<TemporaryDocument>('/material-dispatches/temporary-documents',{csrf:session.csrfToken,body:{...body,requestKey:request.current.key}});setDocuments(old=>[saved,...old.filter(d=>d.id!==saved.id)]);request.current=null;setDraft(null);setNotice(`${saved.number} saved. No stock movement was posted.`);}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}};
 const confirmActual=(checked:boolean)=>{if(!draft)return;if(checked&&!draft.actualReference.trim()){setNotice('Enter the actual document reference before clearing the reminder.');return;}change('detailsConfirmed',checked);};
 // Printed as the same A4 PDF layout as other inventory documents (logo, header, SR#, signatures, footer).
 if(printing){const url='/api/material-dispatches/temporary-documents/'+encodeURIComponent(printing.id)+'/document.pdf';return <section className="temporary-document-view"><div className="temporary-document-actions"><Button variant="neutral" onClick={()=>setPrinting(null)}>← Back to temporary documents</Button><StatusBadge tone="warning">Temporary copy · Replace details with actuals</StatusBadge><Button variant="primary" onClick={()=>window.open(url,'_blank','noopener')}>Open A4 PDF to print</Button></div><DocumentPreview url={url} title={printing.number}/></section>;}
 return <section className="temporary-documents purchase-card" aria-labelledby="temporary-documents-title">
  <div className="temporary-documents-heading"><div><h2 id="temporary-documents-title">Temporary documents</h2><p>Create and print a document when the final transaction details are not available yet.</p></div>{!draft&&<Button variant="primary" onClick={startNew}>Create temporary document</Button>}</div>
  {notice&&<p className="temporary-documents-notice" role="status">{notice}</p>}
  {draft&&<div className="temporary-document-editor"><div className="temporary-editor-heading"><div><h3>{draft.id?'Update document details':'Create a temporary document'}</h3><p>{draft.number?`Temporary number · ${draft.number}`:'A unique temporary number is assigned when you save.'}</p></div><Button variant="neutral" onClick={()=>{if(confirmLeaveWorkspace()){setDraft(null);setNotice('');}}}>Cancel</Button></div>
   <div className="temporary-document-fields"><Field id="temp-type" label="Document type"><select id="temp-type" value={draft.type} disabled={!!draft.id} onChange={e=>change('type',e.target.value as TemporaryType)}>{types.map(type=><option value={type.id} key={type.id}>{type.label}</option>)}</select></Field><Field id="temp-date" label="Document date"><input id="temp-date" type="date" value={draft.date} onChange={e=>change('date',e.target.value)}/></Field><Field id="temp-warehouse" label="Warehouse"><select id="temp-warehouse" value={draft.warehouse} onChange={e=>change('warehouse',e.target.value)}><option value="">Select warehouse</option>{locations.map(location=><option key={location}>{location}</option>)}</select></Field><Field id="temp-party" label="Supplier, site or destination"><input id="temp-party" value={draft.party} onChange={e=>change('party',e.target.value)} placeholder="Enter the party or site"/></Field><Field id="temp-source" label="Related PO / IPO / reference"><input id="temp-source" value={draft.sourceReference} onChange={e=>change('sourceReference',e.target.value)} placeholder="Optional reference"/></Field><Field id="temp-notes" label="Notes"><input id="temp-notes" value={draft.notes} onChange={e=>change('notes',e.target.value)} placeholder="Optional notes for the printed copy"/></Field></div>
   <div className="temporary-lines-wrap"><div className="temporary-lines-heading"><h4>Items</h4><Button variant="neutral" onClick={()=>change('lines',[...draft.lines,blankLine()])}>Add item</Button></div><datalist id="temporary-stock-items">{stockItems.map(item=><option key={item.id} value={item.id}>{item.description}</option>)}</datalist><div className="temporary-lines-scroll"><table className="temporary-lines-table"><thead><tr><th>Item ID</th><th>Description</th><th>Qty</th><th>Unit</th><th>Remarks</th><th></th></tr></thead><tbody>{draft.lines.map((line,index)=><tr key={index}><td><input list="temporary-stock-items" aria-label={`Item ID ${index+1}`} value={line.itemId} onChange={e=>updateLine(index,'itemId',e.target.value)} placeholder="Search or enter ID"/></td><td><input aria-label={`Description ${index+1}`} value={line.description} onChange={e=>updateLine(index,'description',e.target.value)}/></td><td><input aria-label={`Quantity ${index+1}`} inputMode="decimal" value={line.quantity} onChange={e=>updateLine(index,'quantity',e.target.value)}/></td><td><input aria-label={`Unit ${index+1}`} value={line.unit} onChange={e=>updateLine(index,'unit',e.target.value)}/></td><td><input aria-label={`Remarks ${index+1}`} value={line.remarks} onChange={e=>updateLine(index,'remarks',e.target.value)}/></td><td><Button variant="neutral" aria-label={`Remove item ${index+1}`} onClick={()=>change('lines',draft.lines.filter((_,i)=>i!==index))}>Remove</Button></td></tr>)}</tbody></table></div></div>
   {draft.id&&<div className="temporary-actual-update"><Field id="temp-actual-reference" label="Actual document reference"><input id="temp-actual-reference" value={draft.actualReference} onChange={e=>change('actualReference',e.target.value)} placeholder="Enter the final IGP / OGP / IRR / transfer reference"/></Field><label><input type="checkbox" checked={draft.detailsConfirmed} onChange={e=>confirmActual(e.target.checked)}/> Actual details have been checked and updated</label></div>}
   <div className="temporary-document-editor-actions"><Button variant="primary" disabled={busy} onClick={()=>void save()}>{draft.id?'Save updates':'Save temporary document'}</Button>{draft.id&&<Button variant="secondary" onClick={()=>{if(changed){setNotice('Save updates before printing: the A4 document prints the saved details.');return;}setPrinting(draft);setDraft(null);}}>Print temporary document</Button>}</div>
  </div>}
  <div className="temporary-documents-bucket"><div className="temporary-bucket-heading"><div><h3>Saved temporary documents</h3><p>Find, edit and print all saved temporary documents.</p></div><StatusBadge tone={pending.length?'warning':'success'}>{pending.length} pending</StatusBadge></div>
   <div className="pz-form-grid"><Field id="temporary-search" label="Search temporary documents"><input id="temporary-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field id="temporary-status" label="Status"><select id="temporary-status" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All documents</option><option value="pending">Needs actual details</option><option value="confirmed">Details confirmed</option></select></Field></div>
   {!visible.length?<p className="temporary-documents-empty">No temporary documents match this search.</p>:<div className="temporary-documents-list">{visible.map(doc=><article className="temporary-document-row" key={doc.id}><div><strong>{doc.number}</strong><span>{titleOf(doc.type)} · {doc.party||'Party/site not entered'} · {doc.warehouse} · {doc.date}</span><small>{doc.detailsConfirmed?'Actual details confirmed':'Needs actual details'}</small></div><div className="temporary-document-row-actions"><Button variant="neutral" onClick={()=>edit(doc)}>Edit document</Button><Button variant="secondary" onClick={()=>setPrinting(doc)}>Print</Button></div></article>)}</div>}
   <ListPagination pagination={pagination} onPageChange={setPage} label="temporary documents"/>
  </div>
 </section>;
}
