import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {BoqCosting} from '../pages/BoqCosting.js';

/** Read the immutable BOQ revision attached to this quotation; never reprice from current masters. */
export function ManagementQuotationCosting({revisionId}:{revisionId:string}){
 const [costing,setCosting]=useState<any>(),[error,setError]=useState('');
 useEffect(()=>{let active=true;setCosting(undefined);setError('');void api<any>(`/boqs/${revisionId}`).then(row=>{if(active)setCosting(row);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[revisionId]);
 return <section className="pz-panel pz-stack" aria-label="Management quotation costing"><h2>Costing Detail</h2><p className="pz-caption">Saved BOQ costing linked to this quotation. Current database rate changes are not applied to this saved version.</p>{error&&<p className="form-error" role="alert">{error}</p>}{!costing&&!error&&<p role="status">Loading saved quotation costing…</p>}{costing&&<BoqCosting snapshot={costing.snapshot} number={costing.number} createdAt={costing.created_at} pdfUrl={`/api/boqs/${costing.id}/costing.pdf`}/>}</section>;
}
