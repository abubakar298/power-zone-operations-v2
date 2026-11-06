import {useEffect,useRef} from 'react';
import {openStep} from './back-steps.js';
/** While `active`, the top-bar Back arrow calls `close` (closing the open record) before going back a page. */
export function useBackStep(active:boolean,close:()=>void){
 const latest=useRef(close);latest.current=close;
 useEffect(()=>{
  if(!active)return;
  return openStep(()=>latest.current());
 },[active]);
}
