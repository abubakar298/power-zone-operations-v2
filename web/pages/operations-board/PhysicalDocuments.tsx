import {useEffect,useMemo,useRef,useState} from 'react';
import {AccountsPhysicalDocuments} from '../AccountsPhysicalDocuments.js';
import type {Session} from '../../api.js';
import {Button} from '../../ui/Button.js';
import {DocumentForm} from './SiteDetail.js';
import {confirmLeaveWorkspace} from '../../hooks/useUnsavedChanges.js';
import type {Site} from './types.js';
import '../../ui/accounts.css';
import '../../components/material-documents.css';

/** Reuse the same physical-original register as Accounts, from the scoped Operations source. */
export function OperationsPhysicalDocuments({sites,session,loading,onRefresh,onSaved}:{sites:Site[];session:Session;loading:boolean;onRefresh:()=>void;onSaved:(site:Site)=>void}){
 const [selected,setSelected]=useState<{siteId:string;documentId:string}|null>(null),[busy,setBusy]=useState(false),dialog=useRef<HTMLDialogElement>(null);
 const records=useMemo(()=>sites.map(s=>({id:s.id,name:s.name,ipo:s.ipo,completed:s.completed===true,version:s.version,documents:(s.documents??[]).map(d=>({...d,label:d.id===`${s.id}:completion-documents`||d.id===`${s.id}:historical-handover-documents`?'VSO & acknowledgment':d.label}))})),[sites]);
 const site=sites.find(s=>s.id===selected?.siteId),doc=site?.documents?.find(d=>d.id===selected?.documentId);
 useEffect(()=>{if(selected&&!dialog.current?.open)dialog.current?.showModal();},[selected]);
 function close(){if(!busy&&confirmLeaveWorkspace())dialog.current?.close();}
 return <><div className="ob-page-title"><div><h1>Physical Documents</h1><p>Track the original documents as they move between site, offices and Accounts.</p></div></div><AccountsPhysicalDocuments operations={{sites:records,loading,onRefresh,onUpdate:row=>setSelected({siteId:row.site.id,documentId:row.id})}}/>
 {selected&&<dialog ref={dialog} className="operations-theme material-document-dialog" aria-labelledby="operations-document-location-title" onCancel={e=>{e.preventDefault();close();}} onClose={()=>{setSelected(null);setBusy(false);}}><header><div><h2 id="operations-document-location-title">Update document location</h2><p>{site?.name} · {site?.ipo}</p></div><Button variant="neutral" disabled={busy} onClick={close}>Close</Button></header>{site&&doc?<DocumentForm key={`${site.id}:${site.version}:${doc.id}`} site={site} doc={doc} session={session} editing={false} onBusy={setBusy} onCancel={close} onSaved={updated=>{onSaved(updated);dialog.current?.close();}}/>:<p role="alert">This document is no longer in the current register. Close and refresh.</p>}</dialog>}
 </>;
}
