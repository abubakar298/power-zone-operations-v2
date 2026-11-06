import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {ExternalApproval} from './ExternalApproval.js';
export function QuotationApproval({session,quotationId,cniId,onApproved}:{session:Session;quotationId?:string;cniId?:string;onApproved:()=>Promise<void>}){
 const [endpoint,setEndpoint]=useState(quotationId?`/coordinator/quotations/${quotationId}/external-approval`:''),[error,setError]=useState('');
 useEffect(()=>{let active=true;if(cniId)void api<any>(`/cni/${cniId}`).then(d=>{if(active&&d.versions?.[0])setEndpoint(`/cni/${d.id}/versions/${d.versions[0].id}/external-approval`);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[cniId]);
 return <section className="pz-panel">{error&&<p className="form-error" role="alert">{error}</p>}{!endpoint&&!error&&<p role="status">Loading saved quotation…</p>}{endpoint&&<ExternalApproval key={endpoint} expanded quotationApproval preauthorized session={session} endpoint={endpoint} onApproved={async()=>{window.dispatchEvent(new CustomEvent('pz:workspace-open'));await onApproved();}}/>}</section>;
}
