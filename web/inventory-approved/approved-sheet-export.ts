import {fitA4Image} from '../../shared/a4-image-fit.js';
import {waitForMaterialImages,prepareMaterialImageClone} from './material-image-export.js';
/** Print or save approved-template sheets (.issue-print-sheet) exactly as the material DO preview does:
 * A4, one sheet per page, compressed images. Printing and saving never change any record. */
export async function printApprovedSheets(root:HTMLElement,title:string){
 const frame=document.createElement('iframe');frame.title=title;frame.style.cssText='position:fixed;width:0;height:0;border:0';document.body.append(frame);
 const doc=frame.contentDocument!;doc.open();
 doc.write('<!doctype html><html><head><base href="'+location.origin+'/"><title>Power Zone · '+title.replace(/[<>&"]/g,'')+'</title>'+[...document.head.querySelectorAll('link[rel=stylesheet],style')].map(e=>e.outerHTML).join('')+'<style>@page{size:A4;margin:7mm}body{margin:0;background:white}.approved-inventory .igp-sheet{width:196mm!important;max-width:none!important;margin:0!important;box-shadow:none!important;border:0!important}.approved-inventory .igp-copy{display:contents!important}</style></head><body>'+'<div class="approved-inventory">'+root.outerHTML+'</div></body></html>');
 doc.close();await doc.fonts.ready;
 await Promise.all([...doc.images].map(img=>img.complete?Promise.resolve():new Promise<void>(resolve=>{img.onload=()=>resolve();img.onerror=()=>resolve();})));
 frame.contentWindow!.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow!.focus();frame.contentWindow!.print();
}
export async function saveApprovedSheetsPdf(root:HTMLElement,filename:string){
 await document.fonts.ready;await waitForMaterialImages(root);
 const [{jsPDF},{default:html2canvas}]=await Promise.all([import('jspdf'),import('html2canvas')]),pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
 for(const [i,page]of [...root.querySelectorAll<HTMLElement>('.issue-print-sheet')].entries()){
  if(i)pdf.addPage();
  const canvas=await (html2canvas as unknown as (el:HTMLElement,options:Record<string,unknown>)=>Promise<HTMLCanvasElement>)(page,{backgroundColor:'#ffffff',scale:2,logging:false,onclone:async(doc:Document)=>{doc.querySelectorAll<HTMLElement>('.approved-inventory [style*="zoom"]').forEach(e=>e.style.zoom='1');doc.querySelectorAll<HTMLElement>('.issue-print-sheet').forEach(e=>{e.style.setProperty('height','auto','important');e.style.setProperty('max-height','none','important');e.style.setProperty('overflow','visible','important');});await prepareMaterialImageClone(doc);}});
  const fit=fitA4Image(canvas.width,canvas.height);pdf.addImage(canvas.toDataURL('image/jpeg',0.8),'JPEG',fit.x,fit.y,fit.width,fit.height,undefined,'FAST');
 }
 pdf.save(filename);
}
