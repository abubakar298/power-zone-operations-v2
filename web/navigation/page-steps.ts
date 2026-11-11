import {useEffect,useRef,useState} from 'react';

/**
 * Pages and cards inside a workspace as Back steps. The choice is written into the address
 * (#key=value), so Back returns to the previous page or card without reloading.
 */
const kept=['workspace','viewAs'];
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
/** Address of a card or tab chosen on the current page. */
export function choiceAddress(key:string,value:string){const next=params();next.set(key,value);return address(next);}
export function choiceIn<T extends string>(value:string|null,allowed:readonly T[],fallback:T):T{return (allowed as readonly string[]).includes(value??'')?value as T:fallback;}

/** A card or tab on a page that is a Back step: choosing one adds a step; Back shows the previous choice again. `allowed` must be a constant list. */
export function usePageChoice<T extends string>(key:string,allowed:readonly T[],fallback:T){
 const [value,setValue]=useState<T>(()=>choiceIn(addressValue(key),allowed,fallback));
 const current=useRef(value);current.current=value;
 useEffect(()=>{
  const follow=()=>setValue(choiceIn(addressValue(key),allowed,fallback));
  window.addEventListener('popstate',follow);return()=>window.removeEventListener('popstate',follow);
 },[key]);
 // The new step stays on the same page, so it keeps what that page remembered (for example the exact Accounts page).
 const choose=(next:T)=>{if(next===current.current)return;history.pushState({...(history.state??{})},'',choiceAddress(key,next));current.current=next;setValue(next);};
 return [value,choose] as const;
}
