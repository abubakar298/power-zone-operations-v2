/**
 * In-portal Back, the way every app works: each page or tab opened is a step in the browser
 * history, and Back (the arrow or the browser key) returns one step without reloading.
 * Opened records and windows are not history steps (closing one must never move the
 * browser): the top-bar arrow closes an open record first, and each window has its own
 * Back arrow that closes it.
 */
const EVENT='pz:back-steps';
type Layer={onBack:()=>void};
let installed=false,lastPush=0;
const layers:Layer[]=[];
const depth=()=>Number((history.state as {pzDepth?:number}|null)?.pzDepth??0);
/** How many Back steps the current page is from the first page of this tab. */
export const stepDepth=depth;
const notify=()=>window.dispatchEvent(new Event(EVENT));
export const recentPush=(ms=600)=>Date.now()-lastPush<ms;
// The address shown before the latest Back/Forward, so a page can tell whether Back left it.
let shownHref='',leftHref='',shownDepth=0,leftDepth=0;
const shown=()=>{shownHref=location.href;shownDepth=depth();};
/** During a Back/Forward: the address that was showing just before it. */
export const previousAddress=()=>leftHref;
/** During a Back/Forward: its step number, so a page that stays can return to it (history.go). */
export const previousDepth=()=>leftDepth;
const IN_PORTAL='pz-in-portal';
const outside=()=>location.pathname==='/'||/^\/(login|setup|account-link|forgot-password)(\/|$)/.test(location.pathname);
// Signed-in pages mark this tab as inside the portal; the sign-in pages clear it.
function rememberPortal(){try{if(outside())sessionStorage.removeItem(IN_PORTAL);else sessionStorage.setItem(IN_PORTAL,'1');}catch{}}
export function installBackSteps(){
 if(installed||typeof window==='undefined')return;installed=true;
 const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
 history.pushState=((data:unknown,unused:string,url?:string|URL|null)=>{
  const target=url==null?location.href:new URL(String(url),location.href).href;
  // Re-opening the page already shown is not a new step.
  if(target===location.href){replace({...(history.state??{}),...(data as object??{})},unused,url);shown();notify();return;}
  push({...(data as object??{}),pzDepth:depth()+1},unused,url);lastPush=Date.now();shown();rememberPortal();notify();
 }) as History['pushState'];
 history.replaceState=((data:unknown,unused:string,url?:string|URL|null)=>{
  replace({...(history.state??{}),...(data as object??{}),pzDepth:depth()},unused,url);shown();rememberPortal();notify();
 }) as History['replaceState'];
 // Registered first, so pages listening to popstate already see the address that was left.
 window.addEventListener('popstate',()=>{leftHref=shownHref;leftDepth=shownDepth;shown();notify();});
 shown();
 // Arriving from another portal page by a full page change (for example Dashboard → Inventory)
 // still has a page to go back to. The browser hides the previous address, so this tab
 // remembers that it is already inside the portal.
 try{if(history.state==null&&!outside()&&sessionStorage.getItem(IN_PORTAL))replace({pzDepth:1},'');}catch{}
 rememberPortal();
 observeDialogs();
}
export function canGoBack(){return layers.length>0||depth()>0;}
/** Closes the open record first; otherwise returns to the previous page or tab. */
export function goBack(){
 const layer=layers.at(-1);
 if(layer){try{layer.onBack();}catch{}return;}
 if(depth()>0)history.back();
}
export function onBackStepsChange(listener:()=>void){window.addEventListener(EVENT,listener);return()=>window.removeEventListener(EVENT,listener);}
/** Registers something opened on the current page that Back should close first; returns its remover. */
export function openStep(onBack:()=>void){
 const layer={onBack};layers.push(layer);notify();
 return ()=>{const index=layers.indexOf(layer);if(index>=0){layers.splice(index,1);notify();}};
}
function observeDialogs(){
 // The page behind an open window cannot be clicked, so each window carries its own Back arrow.
 const addArrow=(dialog:HTMLDialogElement)=>{
  if(!dialog.open||!dialog.matches(':modal')||dialog.querySelector(':scope > .pz-dialog-back'))return;
  const back=document.createElement('button');back.type='button';back.className='pz-back-button pz-dialog-back';
  back.setAttribute('aria-label','Back to the previous page');back.title='Back';
  back.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg><span>Back</span>';
  // Same as the window's own Close/Escape: the window decides (for example, unsaved changes).
  back.addEventListener('click',()=>{const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);if(!cancel.defaultPrevented)dialog.close();});
  dialog.prepend(back);
 };
 const sweep=()=>{for(const dialog of document.querySelectorAll('dialog'))addArrow(dialog);};
 new MutationObserver(()=>queueMicrotask(sweep)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
}
