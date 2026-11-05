/**
 * In-portal Back, the way every app works: each page, tab or opened window is a step in
 * the browser history, and Back (the arrow or the browser key) returns one step without
 * reloading. Opened windows (<dialog>) and in-page record views register as steps, so
 * Back closes them first.
 */
const EVENT='pz:back-steps';
type Step={id:number;url:string;onBack:()=>void};
let installed=false,nextId=1,ignorePops=0,lastPush=0;
const stack:Step[]=[];
const depth=()=>Number((history.state as {pzDepth?:number}|null)?.pzDepth??0);
const notify=()=>window.dispatchEvent(new Event(EVENT));
export const recentPush=(ms=600)=>Date.now()-lastPush<ms;
export function installBackSteps(){
 if(installed||typeof window==='undefined')return;installed=true;
 const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
 history.pushState=((data:unknown,unused:string,url?:string|URL|null)=>{
  const target=url==null?location.href:new URL(String(url),location.href).href;
  const step=(data as {pzStep?:number}|null)?.pzStep;
  // Re-opening the page already shown is not a new step.
  if(!step&&target===location.href){replace({...(history.state??{}),...(data as object??{})},unused,url);notify();return;}
  push({...(data as object??{}),pzDepth:depth()+1},unused,url);lastPush=Date.now();notify();
 }) as History['pushState'];
 history.replaceState=((data:unknown,unused:string,url?:string|URL|null)=>{
  replace({...(history.state??{}),...(data as object??{}),pzDepth:depth()},unused,url);notify();
 }) as History['replaceState'];
 // First listener on the page: closing a window that removed its own step must not
 // reach the pages' own navigation handlers.
 window.addEventListener('popstate',event=>{
  if(ignorePops>0){ignorePops--;event.stopImmediatePropagation();notify();return;}
  const current=(history.state as {pzStep?:number}|null)?.pzStep;
  let closed=false,samePage=true;
  while(stack.length&&stack.at(-1)!.id!==current){const step=stack.pop()!;closed=true;if(step.url!==location.href)samePage=false;try{step.onBack();}catch{}}
  // Closing a window keeps the same page, so the page's own navigation need not react.
  if(closed&&samePage)event.stopImmediatePropagation();
  notify();
 });
 // Arriving from another portal page (a full page change) still has a page to go back to.
 if(history.state==null&&document.referrer){try{const from=new URL(document.referrer);if(from.origin===location.origin&&!/^\/(login|setup|account-link)/.test(from.pathname))replace({pzDepth:1},'');}catch{}}
 observeDialogs();
}
export function canGoBack(){return depth()>0;}
export function goBack(){if(canGoBack())history.back();}
export function onBackStepsChange(listener:()=>void){window.addEventListener(EVENT,listener);return()=>window.removeEventListener(EVENT,listener);}
/** Adds a Back step for something opened on the current page; returns a closer for when it closes itself. */
export function openStep(onBack:()=>void){
 const step={id:nextId++,url:location.href,onBack};
 history.pushState({...(history.state??{}),pzStep:step.id},'',location.href);
 stack.push(step);
 return ()=>{
  const index=stack.indexOf(step);if(index<0)return;
  stack.splice(index,1);
  if(index===stack.length&&(history.state as {pzStep?:number}|null)?.pzStep===step.id){ignorePops++;history.back();}
 };
}
function observeDialogs(){
 const open=new Map<HTMLDialogElement,()=>void>();
 const track=(dialog:HTMLDialogElement)=>{
  if(open.has(dialog)||!dialog.open||!dialog.matches(':modal'))return;
  // The page behind an open window cannot be clicked, so the window carries its own Back arrow.
  if(!dialog.querySelector(':scope > .pz-dialog-back')){
   const back=document.createElement('button');back.type='button';back.className='pz-back-button pz-dialog-back';
   back.setAttribute('aria-label','Back to the previous page');back.title='Back';
   back.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg><span>Back</span>';
   back.addEventListener('click',()=>history.back());
   dialog.prepend(back);
  }
  open.set(dialog,openStep(()=>{
   open.delete(dialog);
   const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);
   if(!cancel.defaultPrevented)dialog.close();
   // A window that stays open (for example, the person kept unsaved changes) gets its step back.
   setTimeout(()=>{if(dialog.isConnected&&dialog.open)track(dialog);},0);
  }));
 };
 const release=(dialog:HTMLDialogElement)=>{const close=open.get(dialog);if(!close)return;open.delete(dialog);close();};
 const sweep=()=>{
  for(const dialog of document.querySelectorAll('dialog'))dialog.open?track(dialog):release(dialog);
  for(const dialog of [...open.keys()])if(!dialog.isConnected||!dialog.open)release(dialog);
 };
 new MutationObserver(()=>queueMicrotask(sweep)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
}
