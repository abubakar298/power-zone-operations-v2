import {useCallback,useEffect,useRef,useState} from 'react';
import {previousAddress,recentPush,stepDepth} from './back-steps.js';
import {confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';

/**
 * Pages and cards inside a workspace as Back steps. The choice is written into the address
 * (#key=value), so Back returns to the previous page or card without reloading.
 */
const kept=['workspace','viewAs'];
// These name the page itself; every other #key is a card or tab chosen on that page.
const pageKeys=['workspace','viewAs','page','accountsTab','operationsArea'];
const params=()=>new URLSearchParams(location.hash.replace(/^#/,''));
const address=(values:URLSearchParams)=>{const hash=values.toString();return location.pathname+location.search+(hash?'#'+hash:'');};

export function addressValue(key:string){return params().get(key);}
/** Address of another page in the same workspace: choices made on the previous page are left behind. */
export function pageAddress(key:string,value:string){
 const current=params(),next=new URLSearchParams();
 for(const name of kept){const value=current.get(name);if(value!=null)next.set(name,value);}
 next.set(key,value);
 return address(next);
}
// Every #key used for a card or tab (see usePageChoice).
const choiceKeys=new Set<string>();
/** The address without the cards chosen on the page (every other part of the address is kept). */
export function pageOnlyAddress(values=params()){
 const next=new URLSearchParams();
 for(const [name,value] of values)if(!choiceKeys.has(name))next.append(name,value);
 return address(next);
}
/** Which page an address shows (path and page keys), ignoring the cards chosen on it. */
export function pageOf(href:string){
 const url=new URL(href,location.href),hash=new URLSearchParams(url.hash.replace(/^#/,''));
 return url.pathname+url.search+'#'+pageKeys.map(name=>name+'='+(hash.get(name)??'')).join('&');
}
/** Address of a card or tab chosen on the current page. */
export function choiceAddress(key:string,value:string){const next=params();next.set(key,value);return address(next);}
export function choiceIn<T extends string>(value:string|null,allowed:readonly T[]|null,fallback:T):T{
 if(value==null)return fallback;
 return !allowed||(allowed as readonly string[]).includes(value)?value as T:fallback;
}
/** Records a card choice as a Back step; several choices from one click make one step. */
export function pushChoice(key:string,value:string){
 const next=choiceAddress(key,value);
 if(recentPush(150))history.replaceState(history.state,'',next);
 else history.pushState({...(history.state??{})},'',next);
}

type ChoiceOptions<T>={
 /** Runs after Back or Forward changed the choice (for example to clear a search, as clicking the card does). */
 onBack?:(value:T)=>void;
 /** Ask about unsaved changes before Back changes the choice; staying keeps the card and its address. */
 guard?:boolean;
};
/**
 * A card or tab on a page that is a Back step: choosing one adds a step; Back shows the previous
 * choice again. `allowed` (a constant list, or null for any value) protects against odd addresses.
 * Back to another page is left to that page's own handling.
 */
export function usePageChoice(key:string,allowed:null,fallback:string,options?:ChoiceOptions<string>):readonly [string,(next:string,reset?:boolean)=>void];
export function usePageChoice<T extends string>(key:string,allowed:readonly T[],fallback:T,options?:ChoiceOptions<T>):readonly [T,(next:T,reset?:boolean)=>void];
export function usePageChoice<T extends string>(key:string,allowed:readonly T[]|null,fallback:T,options:ChoiceOptions<T>={}){
 choiceKeys.add(key);
 const [value,setValue]=useState<T>(()=>choiceIn(addressValue(key),allowed,fallback));
 const current=useRef(value),latest=useRef(options),depth=useRef(0);current.current=value;latest.current=options;
 useEffect(()=>{
  depth.current=stepDepth();
  const follow=()=>{
   const left=previousAddress();
   if(left&&pageOf(left)!==pageOf(location.href))return;
   const next=choiceIn(addressValue(key),allowed,fallback);
   if(next===current.current)return;
   if(latest.current.guard&&!confirmLeaveWorkspace()){history.go(stepDepth()<depth.current?1:-1);return;}
   depth.current=stepDepth();current.current=next;setValue(next);latest.current.onBack?.(next);
  };
  window.addEventListener('popstate',follow);return()=>window.removeEventListener('popstate',follow);
 },[key]);
 // `reset` (for a page resetting itself, not a user's choice) changes the address without adding a step.
 const choose=useCallback((next:T,reset=false)=>{if(next===current.current)return;if(reset)history.replaceState(history.state,'',choiceAddress(key,next));else pushChoice(key,next);depth.current=stepDepth();current.current=next;setValue(next);},[key]);
 return [value,choose] as const;
}
