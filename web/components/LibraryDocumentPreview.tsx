import {useEffect,useState} from 'react';
import {Button} from '../ui/Button.js';
import {DocumentPreview} from './DocumentPreview.js';
import {api} from '../api.js';


export type PreviewDocument={id:string;number:string;customer:string;site:string;type:string;pdfUrl?:string;inputs?:Record<string,unknown>;stage?:string};
/** Loads only existing authorized saved exports. Preview and download share the same bytes. */
export function LibraryDocumentPreview({document:record,stage,onBack}:{document:PreviewDocument;stage:string;onBack:()=>void}) {
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(stage),[loading,setLoading]=useState(true);
 useEffect(()=>{let alive=true,objectUrl='';const controller=new AbortController();
 async function load(){try{
 let blob:Blob;
 if(record.pdfUrl){
  if(record.type==='Quotation'){const saved=await api<any>(`/commercial/quotations/${record.id}`);if(alive&&saved.workflow_status)setStatus(`${stage} · ${saved.workflow_status}`);}
  const response=await fetch(record.pdfUrl,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(!response.ok){let message='Unable to load this document.';try{message=(await response.json()).message??message}catch{}throw new Error(message);}
  blob=await response.blob();if(!blob.type.includes('application/pdf'))throw new Error('The document export is not a PDF.');
 }else{
  // An unfinished survey has saved input fields, not a finalized calculated BOQ.
  const {jsPDF}=await import("jspdf");const {autoTable}=await import("jspdf-autotable");const pdf=new jsPDF();pdf.setFontSize(18);pdf.text('POWER ZONE',14,20);pdf.setFontSize(12);pdf.text('Saved survey draft',14,30);
  const rows=[['Document',record.number],['Customer',record.customer],['Site',record.site],['Stage',stage],...Object.entries(record.inputs??{}).filter(([key,value])=>value!=null&&typeof value!=='object'&&!/cost|price|rate|profit|margin|markup/i.test(key)).map(([key,value])=>[key.replace(/([a-z])([A-Z])/g,'$1 $2'),String(value)])];
  autoTable(pdf,{startY:38,head:[['Field','Saved value']],body:rows,theme:'grid',styles:{fontSize:10},headStyles:{fillColor:[85,71,208]}});blob=pdf.output('blob');
 }
 objectUrl=URL.createObjectURL(blob);if(alive)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);
 }catch(e){if(alive)setError((e as Error).message);}finally{if(alive)setLoading(false);}}
 void load();return()=>{alive=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
 },[record,stage]);
 function download(){if(!url)return;const link=window.document.createElement('a');link.href=url;link.download=`${record.number}-${record.type}.pdf`.replace(/[/\\:*?"<>|]/g,'-');link.click();}
 return <section className="pz-panel pz-stack" aria-busy={loading}><div><h2>Document preview</h2><p><strong>{record.number}</strong> · {record.type}</p><p>{record.customer} · {record.site}</p><p>Current stage: <strong>{status}</strong></p>{record.type==='Survey draft'&&<p>Saved survey fields only. A calculated BOQ becomes available after costing is prepared.</p>}</div>
 <div className="pz-action-row"><Button variant="neutral" onClick={onBack}>Back to documents</Button><Button variant="primary" disabled={!url||loading} onClick={download}>Download PDF</Button></div>
 {loading&&<p role="status">Loading saved document…</p>}{error&&<p className="form-error" role="alert">{error}</p>}{url&&<DocumentPreview title={`${record.type} — ${record.number}`} url={url}/>}</section>;
}
