import {useRef,useState} from 'react';
import {Button} from '../ui/Button.js';
import {paginateMaterialRows} from './print-pagination.mjs';
import {printApprovedSheets,saveApprovedSheetsPdf} from './approved-sheet-export.js';
import {downloadName} from '../../shared/download-name.js';
import './approved-inventory.css';
import './temporary.css';
const powerZoneLogo='/brand/power-zone-white.png';
export type InventorySheetRow={id:string;name:string;unit:string;quantity:string;remarks:string};
export type SheetCopy={name:string;note:string};
export type InventorySheetProps={copies?:SheetCopy[];title:string;number:string;details:{label:string;value:string}[];rows:InventorySheetRow[];quantityLabel?:string;notes?:string;signatures:[string,string];footerNote?:string;site?:string};
/** One document in the approved material-DO sheet layout: logo header, details, SR# item table,
 * remarks and the two sign-off boxes on every page, with Print and Download PDF. */
export function InventorySheet({copies=[],title,number,details,rows,quantityLabel='Qty',notes,signatures,footerNote,site}:InventorySheetProps){
 const [copy,setCopy]=useState('all'),shownCopies:(SheetCopy|undefined)[]=copies.length?copies.filter(c=>copy==='all'||c.name===copy):[undefined];
 const root=useRef<HTMLDivElement>(null),[zoom,setZoom]=useState(100),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const listed=rows.filter(r=>r.id||r.name||r.quantity||r.remarks).map(r=>({...r,issued:r.quantity}));
 const pages:((typeof listed)[number]|undefined)[][]=paginateMaterialRows(listed,'do',{headerText:site??'',blankRows:3});
 async function save(){if(!root.current)return;setBusy(true);setError('');try{await saveApprovedSheetsPdf(root.current,downloadName({site,documentType:title,identity:number,reference:number,extension:'pdf'}));}catch(e){setError('Could not create the PDF: '+(e instanceof Error?e.message:'conversion failed')+'. Use Print, or try again.');}finally{setBusy(false);}}
 return <section className="ipo-document-preview" aria-label={number}>
  <div className="ipo-preview-heading"><h4>{number}</h4><div className="pz-action-row">{copies.length>1&&<label className="inventory-sheet-copies">Copies<select value={copy} onChange={e=>setCopy(e.target.value)}><option value="all">All copies ({copies.length})</option>{copies.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></label>}<Button onClick={()=>root.current&&void printApprovedSheets(root.current,number)}>Print</Button><Button loading={busy} onClick={()=>void save()}>Download PDF</Button></div></div>
  {error&&<p role="alert">{error}</p>}
  <div className="pz-action-row"><Button onClick={()=>setZoom(Math.max(50,zoom-10))}>Zoom out</Button><span>{zoom}%</span><Button onClick={()=>setZoom(Math.min(150,zoom+10))}>Zoom in</Button><Button onClick={()=>setZoom(100)}>Fit width</Button></div>
  <div className="approved-inventory approved-document-scroll"><div className="inventory-app-shell issue-print-preview-page" style={{zoom:zoom/100}} ref={root}>
   <div className="igp-print-document issue-print-preview issue-print-do temporary-sheet">
    {shownCopies.flatMap(sheetCopy=>pages.map((page,pageIndex)=>{const before=pages.slice(0,pageIndex).reduce((n,p)=>n+p.length,0);return <section className="igp-copy" key={(sheetCopy?.name??'')+pageIndex} aria-label={`${number}${sheetCopy?' · '+sheetCopy.name:''} · page ${pageIndex+1}`}>
     <article className="igp-sheet issue-print-sheet">
      <header className="igp-sheet-header"><img className="issue-company-logo" src={powerZoneLogo} alt="Power Zone"/><div><h2>{title}</h2><strong>{number}</strong></div></header>
      {sheetCopy&&<div className="issue-print-copy"><strong>{sheetCopy.name}</strong><span>{sheetCopy.note}</span></div>}
      <dl className="igp-sheet-details temporary-sheet-details">{details.map(d=><div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>
      <table className="igp-print-table issue-print-table temporary-sheet-table">
       <colgroup><col className="temporary-col-sr"/><col className="temporary-col-item"/><col className="temporary-col-uom"/><col className="temporary-col-qty"/><col className="temporary-col-remarks"/></colgroup>
       <thead><tr><th className="issue-print-sr">Sr. No.</th><th>Item name / ID</th><th>UOM</th><th>{quantityLabel}</th><th>Remarks</th></tr></thead>
       <tbody>{page.map((row,rowIndex)=>row?<tr key={rowIndex}><th className="issue-print-sr">{before+rowIndex+1}</th><td className="issue-print-item"><strong>{row.name||'Description pending'}</strong><small>{row.id||'ID pending'}</small></td><td className="issue-print-uom">{row.unit||'—'}</td><td className="issue-print-qty">{row.quantity}</td><td>{row.remarks}</td></tr>:<tr key={rowIndex} className="issue-do-handwritten-row"><th className="issue-print-sr">{before+rowIndex+1}</th><td className="issue-print-item"/><td/><td/><td/></tr>)}</tbody>
      </table>
      <div className="issue-do-footer">
       <div className="issue-master-remarks"><strong>Remarks</strong>{notes?<p className="temporary-sheet-notes">{notes}</p>:<><span/><span/></>}</div>
       <div className="issue-do-signoff issue-do-signoff-pair">{signatures.map(label=><section key={label}><strong>{label}</strong><div><span>Name</span><i/></div><div className="issue-do-signature-row"><span>Signature / stamp</span><i className="issue-do-signature-pad" aria-hidden="true"/></div><div><span>Date</span><i/></div></section>)}</div>
      </div>
      <footer className="issue-do-repeat-reference">{number}{footerNote?' · '+footerNote:''} · Page {pageIndex+1} of {pages.length}</footer>
     </article>
    </section>;}))}
   </div>
  </div></div>
 </section>;
}
