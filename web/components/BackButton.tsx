import {useEffect,useState} from 'react';
import {canGoBack,goBack,onBackTrailChange} from '../navigation/back-trail.js';
import './back-button.css';

/** Back arrow shown in every portal's top bar once there is a previous page to return to. */
export function BackButton(){
 const [available,setAvailable]=useState(canGoBack);
 useEffect(()=>{setAvailable(canGoBack());return onBackTrailChange(()=>setAvailable(canGoBack()));},[]);
 if(!available)return null;
 return <button type="button" className="pz-back-button" aria-label="Back to the previous page" title="Back" onClick={goBack}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
  <span>Back</span>
 </button>;
}
