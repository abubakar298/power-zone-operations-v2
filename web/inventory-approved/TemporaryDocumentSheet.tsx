import {useRef,useState} from 'react';
import {Button} from '../ui/Button.js';
import {paginateMaterialRows} from './print-pagination.mjs';
import {printApprovedSheets,saveApprovedSheetsPdf} from './approved-sheet-export.js';
import {downloadName} from '../../shared/download-name.js';
import './approved-inventory.css';
import './temporary.css';
const powerZoneLogo='/brand/power-zone-white.png';
type TemporaryType='IGP'|'OGP'|'TRF'|'IRR'|'OTHER';
export type TemporarySheetDocument={number:string;type:TemporaryType;date:string;warehouse:string;party:string;sourceReference:string;actualReference:string;notes:string;detailsConfirmed:boolean;lines:{itemId:string;description:string;quantity:string;unit:string;remarks:string}[]};
const titles:Record<TemporaryType,string>={IGP:'Inwards Gate Pass',OGP:'Outwards Gate Pass',TRF:'Stock Transfer',IRR:'Inventory Return Record',OTHER:'Inventory Document'};
const parties:Record<TemporaryType,string>={IGP:'Supplier / source',OGP:'Site / destination',TRF:'Destination',IRR:'Returned from site',OTHER:'Supplier / site / destination'};
const signatures:Record<TemporaryType,[string,string]>={IGP:['Delivered by','Received by storekeeper'],OGP:['Issued by','Received by'],TRF:['Dispatched by','Received by'],IRR:['Returned by','Warehouse received by'],OTHER:['Prepared by','Verified by']};
const blank='To be entered';
/** Temporary document in the same approved sheet layout as the material DO: logo header,
 * status strip, details, SR# item table, remarks and sign-off boxes on every page. */
export function TemporaryDocumentSheet({doc}:{doc:TemporarySheetDocument}){
 const root=useRef<HTMLDivElement>(null),[zoom,setZoom]=useState(100),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const type=doc.type in titles?doc.type:'OTHER',title=titles[type];
 const rows=doc.lines.filter(l=>l.itemId||l.description||l.quantity||l.remarks).map(l=>({id:l.itemId,name:l.description,unit:l.unit,issued:l.quantity,remarks:l.remarks}));
 const pages:((typeof rows)[number]|undefined)[][]=paginateMaterialRows(rows,'do',{headerText:doc.party,blankRows:3});
 const status=doc.detailsConfirmed?`Temporary document · actual details confirmed${doc.actualReference?' · '+doc.actualReference:''}. No stock movement is recorded.`:'TEMPORARY DOCUMENT — confirm and update all details against the actual transaction. No stock movement is recorded.';
 async function save(){if(!root.current)return;setBusy(true);setError('');try{await saveApprovedSheetsPdf(root.current,downloadName({site:doc.party,documentType:title,identity:doc.number,reference:doc.number,extension:'pdf'}));}catch(e){setError('Could not create the PDF: '+(e instanceof Error?e.message:'conversion failed')+'. Use Print, or try again.');}finally{setBusy(false);}}
 return <section className="ipo-document-preview" aria-label={doc.number}>
  <div className="ipo-preview-heading"><h4>{doc.number}</h4><div className="pz-action-row"><Button onClick={()=>root.current&&void printApprovedSheets(root.current,doc.number)}>Print</Button><Button loading={busy} onClick={()=>void save()}>Download PDF</Button></div></div>
  {error&&<p role="alert">{error}</p>}
  <div className="pz-action-row"><Button onClick={()=>setZoom(Math.max(50,zoom-10))}>Zoom out</Button><span>{zoom}%</span><Button onClick={()=>setZoom(Math.min(150,zoom+10))}>Zoom in</Button><Button onClick={()=>setZoom(100)}>Fit width</Button></div>
  <div className="approved-inventory approved-document-scroll"><div className="inventory-app-shell issue-print-preview-page" style={{zoom:zoom/100}} ref={root}>
   <div className="igp-print-document issue-print-preview issue-print-do temporary-sheet">
    {pages.map((page,pageIndex)=>{const before=pages.slice(0,pageIndex).reduce((n,p)=>n+p.length,0);return <section className="igp-copy" key={pageIndex} aria-label={`${doc.number} · page ${pageIndex+1}`}>
     <article className="igp-sheet issue-print-sheet">
      <header className="igp-sheet-header"><img className="issue-company-logo" src={powerZoneLogo} alt="Power Zone"/><div><h2>{title}</h2><strong>{doc.number}</strong></div></header>
      <div className="igp-demo-strip temporary-sheet-strip">{status}</div>
      <dl className="igp-sheet-details temporary-sheet-details">
       <div><dt>{parties[type]}</dt><dd>{doc.party||blank}</dd></div>
       <div><dt>Warehouse</dt><dd>{doc.warehouse||blank}</dd></div>
       <div><dt>Document date</dt><dd>{doc.date||blank}</dd></div>
       <div><dt>Related PO / IPO / reference</dt><dd>{doc.sourceReference||blank}</dd></div>
       <div><dt>Actual document reference</dt><dd>{doc.actualReference||'Not yet issued'}</dd></div>
      </dl>
      <table className="igp-print-table issue-print-table temporary-sheet-table">
       <colgroup><col className="temporary-col-sr"/><col className="temporary-col-item"/><col className="temporary-col-uom"/><col className="temporary-col-qty"/><col className="temporary-col-remarks"/></colgroup>
       <thead><tr><th className="issue-print-sr">Sr. No.</th><th>Item name / ID</th><th>UOM</th><th>Qty</th><th>Remarks</th></tr></thead>
       <tbody>{page.map((row,rowIndex)=>row?<tr key={rowIndex}><th className="issue-print-sr">{before+rowIndex+1}</th><td className="issue-print-item"><strong>{row.name||'Description pending'}</strong><small>{row.id||'ID pending'}</small></td><td className="issue-print-uom">{row.unit||'—'}</td><td className="issue-print-qty">{row.issued}</td><td>{row.remarks}</td></tr>:<tr key={rowIndex} className="issue-do-handwritten-row"><th className="issue-print-sr">{before+rowIndex+1}</th><td className="issue-print-item"/><td/><td/><td/></tr>)}</tbody>
      </table>
      <div className="issue-do-footer">
       <div className="issue-master-remarks"><strong>Remarks</strong>{doc.notes?<p className="temporary-sheet-notes">{doc.notes}</p>:<><span/><span/></>}</div>
       <div className="issue-do-signoff issue-do-signoff-pair">{signatures[type].map(label=><section key={label}><strong>{label}</strong><div><span>Name</span><i/></div><div className="issue-do-signature-row"><span>Signature / stamp</span><i className="issue-do-signature-pad" aria-hidden="true"/></div><div><span>Date</span><i/></div></section>)}</div>
      </div>
      <footer className="issue-do-repeat-reference">{doc.number} · temporary reference for tracking only; it does not replace the final approved document reference · Page {pageIndex+1} of {pages.length}</footer>
     </article>
    </section>;})}
   </div>
  </div></div>
 </section>;
}
