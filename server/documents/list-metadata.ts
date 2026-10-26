import type {Pool,PoolClient} from 'pg';
export type DocumentListMetadata={documentAmount:string|null;solutionType:string};
const labels:Record<string,string>={'solar-hybrid':'Solar Hybrid','bess-only':'BESS Only','direct-product':'Direct Sale',cni:'C&I'};
/** Only public saved payable and family are projected; no repricing or costs. */
export function snapshotListMetadata(snapshot:any,family?:string|null):DocumentListMetadata{
 const amount=snapshot?.footer?.find((row:any)=>row.label==='Net Total')?.amount??snapshot?.allocation?.total??snapshot?.pricing?.payable??snapshot?.netTotal;
 const savedFamily=family??snapshot?.survey?.family??snapshot?.boqFamily??(snapshot?.source==='C&I proposal'?'cni':undefined);
 return {documentAmount:typeof amount==='string'&&/^\d+(?:\.\d+)?$/.test(amount)?amount:null,solutionType:labels[savedFamily]??'Not recorded'};
}
/** IDs must come from the caller's already-authorized document list. One batch read. */
export async function loadDocumentListMetadata(db:Pool|PoolClient,ids:string[]){
 const keys=[...new Set(ids.filter(id=>/^[0-9a-f-]{36}$/i.test(id)))];if(!keys.length)return new Map<string,DocumentListMetadata>();
 const result=await db.query(`
 SELECT q.id,q.snapshot,COALESCE(b.snapshot#>>'{survey,family}','solar-hybrid') AS family FROM quotation_versions q JOIN boq_revisions b ON b.id=q.boq_revision_id WHERE q.id=ANY($1::uuid[])
 UNION ALL SELECT r.id,q.snapshot,COALESCE(b.snapshot#>>'{survey,family}','solar-hybrid') FROM quotation_revision_requests r JOIN quotation_versions q ON q.id=r.source_quotation_id JOIN boq_revisions b ON b.id=q.boq_revision_id WHERE r.id=ANY($1::uuid[])
 UNION ALL SELECT p.id,p.snapshot,COALESCE(b.snapshot#>>'{survey,family}','solar-hybrid') FROM commercial_pricing_versions p JOIN boq_revisions b ON b.id=p.boq_revision_id WHERE p.id=ANY($1::uuid[])
 UNION ALL SELECT i.id,i.snapshot,COALESCE(b.snapshot#>>'{survey,family}',CASE WHEN b.id IS NOT NULL THEN 'solar-hybrid' END,CASE WHEN i.snapshot->>'solutionId'='DIRECT-PRODUCT' THEN 'direct-product' END) FROM internal_purchase_orders i LEFT JOIN boq_revisions b ON b.id::text=i.snapshot->>'boqRevisionId' WHERE i.id=ANY($1::uuid[])
 UNION ALL SELECT s.id,s.snapshot,COALESCE(b.snapshot#>>'{survey,family}',CASE WHEN b.id IS NOT NULL THEN 'solar-hybrid' END,CASE WHEN s.snapshot->>'solutionId'='DIRECT-PRODUCT' THEN 'direct-product' END) FROM ipo_submissions s LEFT JOIN boq_revisions b ON b.id::text=s.snapshot->>'boqRevisionId' WHERE s.id=ANY($1::uuid[])
 UNION ALL SELECT p.id,v.snapshot,'cni' FROM cni_proposals p JOIN LATERAL(SELECT snapshot FROM cni_proposal_versions WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1)v ON true WHERE p.id=ANY($1::uuid[])
 `,[keys]);
 return new Map(result.rows.map(r=>[r.id,snapshotListMetadata(r.snapshot,r.family)]));
}
