import {confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
/**
 * In-portal Back: remembers the pages a person opens in this browser tab and returns
 * to the previous one. Some workspaces change their page without a browser history
 * entry, so the browser's own Back would leave the portal; this trail covers both.
 */
const KEY='pz-back-trail-v1',MAX=60,EVENT='pz:back-trail',QUIET_MS=1200;
const outside=(url:string)=>/^\/(login|account-link|setup)(\/|$|\?|#)/.test(url)||url==='/';
const here=()=>location.pathname+location.search+location.hash;
function read():string[]{try{const v=JSON.parse(sessionStorage.getItem(KEY)??'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}}
function write(trail:string[]){try{sessionStorage.setItem(KEY,JSON.stringify(trail.slice(-MAX)));}catch{}window.dispatchEvent(new Event(EVENT));}
let installed=false,going=false,lastChange=0,quietUntil=0;
type Kind='load'|'push'|'replace'|'pop';
function record(kind:Kind){
 if(going)return;
 const url=here();
 if(outside(url)){if(/^\/login/.test(url))write([]);return;}
 const trail=read(),top=trail.at(-1),now=Date.now();
 if(top===url)return;
 if(kind==='pop'&&trail.at(-2)===url)trail.pop();
 // A page that tidies its address right after opening, or many quick changes (typing in
 // a search box), update the current step rather than adding new ones.
 else if(kind==='replace'&&trail.length&&(now<quietUntil||now-lastChange<QUIET_MS))trail[trail.length-1]=url;
 else trail.push(url);
 lastChange=now;write(trail);
}
export function installBackTrail(){
 if(installed||typeof window==='undefined')return;installed=true;
 quietUntil=Date.now()+QUIET_MS;
 for(const name of ['pushState','replaceState'] as const){
  const original=history[name].bind(history);
  history[name]=((data:unknown,unused:string,url?:string|URL|null)=>{const result=original(data,unused,url);record(name==='pushState'?'push':'replace');return result;}) as History[typeof name];
 }
 window.addEventListener('popstate',()=>record('pop'));
 window.addEventListener('hashchange',()=>record('push'));
 record('load');
}
export function canGoBack(){return read().length>1;}
export function onBackTrailChange(listener:()=>void){window.addEventListener(EVENT,listener);return()=>window.removeEventListener(EVENT,listener);}
/** Returns to the previous page; reloads it so every workspace opens it from its address. */
export function goBack(){
 const trail=read();if(trail.length<2)return;
 if(!confirmLeaveWorkspace())return;
 trail.pop();const target=trail.at(-1)!;write(trail);
 going=true;quietUntil=Date.now()+QUIET_MS*2;
 // The page reloads at once; if it ever does not, keep remembering pages after a moment.
 setTimeout(()=>{going=false;},1000);
 const samePage=target.split('#')[0]===location.pathname+location.search;
 if(samePage){history.replaceState(history.state,'',target);location.reload();}
 else location.replace(target);
}
