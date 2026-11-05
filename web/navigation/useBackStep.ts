import {useEffect,useRef} from 'react';
import {openStep} from './back-steps.js';
/** While `active`, Back (arrow or browser key) calls `close` instead of leaving the page. */
export function useBackStep(active:boolean,close:()=>void){
 const latest=useRef(close);latest.current=close;
 useEffect(()=>{
  if(!active)return;
  let backed=false;
  const release=openStep(()=>{backed=true;latest.current();});
  return()=>{if(!backed)release();};
 },[active]);
}
