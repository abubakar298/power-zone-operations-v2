import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button.js";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** Read-only authenticated document preview. Existing endpoints enforce access. */
export function DocumentPreview({url,title,mime="application/pdf",data}:{url:string;title:string;mime?:string;data?:Blob}) {
  const host=useRef<HTMLDivElement>(null);
  const [retry,setRetry]=useState(0);
  const [status,setStatus]=useState("Loading document…");
  useEffect(()=>{
    const controller=new AbortController();let cancelled=false;let task:any;
    host.current?.replaceChildren();setStatus("Loading document…");
    void(async()=>{
      try{
        let blob=data;
        if(!blob){
        const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("Unable to load this document. Use the download link or try again.");
        blob=await response.blob();
        }
        if(blob.type.startsWith("image/")||mime.startsWith("image/")){
          const image=document.createElement("img");image.alt=title;
          const reader=new FileReader();reader.readAsDataURL(blob);await new Promise<void>((resolve,reject)=>{reader.onload=()=>resolve();reader.onerror=()=>reject(new Error("Unable to read attachment."));});
          if(cancelled)return;image.src=String(reader.result);host.current?.replaceChildren(image);
        }else{
          const pdf=await import("pdfjs-dist");pdf.GlobalWorkerOptions.workerSrc=pdfWorker;task=pdf.getDocument({data:await blob.arrayBuffer()});const doc=await task.promise;
          for(let n=1;n<=doc.numPages;n++){
            if(cancelled)return;const page=await doc.getPage(n),viewport=page.getViewport({scale:1.25});const canvas=document.createElement("canvas");canvas.width=viewport.width;canvas.height=viewport.height;
            await page.render({canvas,canvasContext:canvas.getContext("2d")!,viewport}).promise;
            if(cancelled)return;const image=document.createElement("img");image.alt=`${title} · page ${n}`;image.src=canvas.toDataURL("image/png");host.current?.append(image);
          }
        }
        if(!cancelled)setStatus("");
      }catch(e){if(!cancelled)setStatus(e instanceof Error?e.message:"Unable to load document.");}
    })();
    return()=>{cancelled=true;controller.abort();void task?.destroy();};
  },[url,title,mime,data,retry]);
  return <section className="ipo-document-preview" aria-label={title}><div className="ipo-preview-heading"><h4>{title}</h4><a href={url} download>Download</a></div>{status&&<p role="status">{status}</p>}{status&&status!=="Loading document…"&&<Button variant="secondary" onClick={()=>setRetry(v=>v+1)}>Retry preview</Button>}<div className="ipo-preview-pages" ref={host}/></section>;
}

