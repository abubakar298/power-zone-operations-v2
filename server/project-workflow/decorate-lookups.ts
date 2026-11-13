import type {Pool,PoolClient} from 'pg';

type Db=Pool|PoolClient;

// The database lookups used to decorate one project workflow record.
// Single-record screens use the direct lookups: exactly the original one-row
// queries. The department list uses the batched lookups: the same queries, run
// once for every record of the list instead of once per record.
export type DecorateLookups={
  finalization(draftId:unknown):Promise<any>;
  quotationRevision(quotationId:unknown):Promise<any>;
  latestQuotation(revisionId:unknown):Promise<any>;
  latestPricing(revisionId:unknown):Promise<any>;
  today():Promise<string>;
  quotationStatus(quotationId:unknown):Promise<any>;
  shared(recordId:unknown):Promise<any>;
  headsup(recordId:unknown):Promise<any>;
  readyGroupCount(packageId:unknown):Promise<any>;
  surveyPackage(packageId:unknown):Promise<any>;
  references(recordId:unknown):Promise<any[]>;
};

// Each query is written once with $KEY standing for the looked-up value, so the
// direct and batched forms cannot drift apart.
type Lookup={sql:string;key:'uuid'|'text'};
export const decorateLookupSql={
  finalization:{key:'uuid',sql:"SELECT f.revision_id FROM boq_draft_finalizations f WHERE draft_id=$KEY"},
  quotationRevision:{key:'uuid',sql:"SELECT boq_revision_id AS revision_id FROM quotation_versions WHERE id=$KEY"},
  latestQuotation:{key:'uuid',sql:"SELECT q.id,q.number,q.version,COALESCE(e.kind,'Draft') AS status,EXISTS(SELECT 1 FROM quotation_dispatch_records d WHERE d.quotation_id=q.id) AS dispatched,EXISTS(SELECT 1 FROM quotation_revision_requests rr WHERE rr.source_quotation_id=q.id) AS revision FROM quotation_versions q LEFT JOIN LATERAL(SELECT kind FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1)e ON true WHERE q.boq_revision_id IN(SELECT id FROM boq_revisions WHERE boq_id=(SELECT boq_id FROM boq_revisions WHERE id=$KEY)) ORDER BY q.created_at DESC,q.version DESC LIMIT 1"},
  latestPricing:{key:'uuid',sql:"SELECT id FROM commercial_pricing_versions WHERE boq_revision_id=$KEY ORDER BY version DESC LIMIT 1"},
  quotationStatus:{key:'uuid',sql:"SELECT q.id,q.number,q.boq_revision_id,COALESCE(e.kind,'Draft') AS status FROM quotation_versions q LEFT JOIN LATERAL(SELECT kind FROM coordination_events WHERE quotation_id=q.id ORDER BY created_at DESC LIMIT 1)e ON true WHERE q.id=$KEY"},
  shared:{key:'uuid',sql:"SELECT q.number AS ipo_number,nullif(trim(q.snapshot#>>'{input,orderNumber}'),'') AS order_number,p.reference,p.input->>'date' AS po_date,i.created_at,i.ipo_id,i.operations_id FROM project_workflow_issuances i JOIN internal_purchase_orders q ON q.id=i.ipo_id JOIN project_po_receipts p ON p.id=i.receipt_id LEFT JOIN ipo_accounts_handoffs h ON h.ipo_id=i.ipo_id JOIN operations_boq_issuances o ON o.id=i.operations_id WHERE i.record_id=$KEY AND (h.ipo_id IS NOT NULL OR q.snapshot#>>'{historicalImport,hideFromIpoShared}'='false')"},
  headsup:{key:'text',sql:"SELECT h.id,h.created_at,h.snapshot,EXISTS(SELECT 1 FROM headsup_department_handoffs d WHERE d.receipt_id=h.id) AS sent FROM customer_headsup_receipts h WHERE EXISTS(SELECT 1 FROM active_headsup_received_sites binding WHERE binding.record_id::text=$KEY) AND NOT EXISTS(SELECT 1 FROM audit_log archived WHERE archived.action='customer.headsup.unsaved:'||h.id::text) AND NOT EXISTS(SELECT 1 FROM customer_headsup_receipts newer WHERE newer.supersedes_id=h.id) AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.snapshot->'matches') m WHERE m->>'recordId'=$KEY) ORDER BY h.created_at DESC LIMIT 1"},
  readyGroupCount:{key:'text',sql:"SELECT count(*) AS n FROM project_workflow_records WHERE stage='approved_dispatch' AND data->>'ublSurveyPackageId'=$KEY AND COALESCE(data->>'readySendUnbound','false')<>'true'"},
  surveyPackage:{key:'uuid',sql:"SELECT jsonb_array_length(snapshot->'sites') AS n FROM ubl_survey_review_packages WHERE id=$KEY"},
  references:{key:'uuid',sql:"SELECT number FROM project_workflow_documents WHERE record_id=$KEY"},
} satisfies Record<string,Lookup>;
export const todaySql="SELECT to_char(now() AT TIME ZONE 'Asia/Karachi','YYYY-MM-DD') AS today";

type Name=keyof typeof decorateLookupSql;
export const directSql=(name:Name)=>decorateLookupSql[name].sql.replaceAll('$KEY','$1');
const batchSql=(name:Name)=>{
  const {sql,key}=decorateLookupSql[name];
  return `SELECT x.raw AS pz_lookup_key,v.* FROM unnest($1::text[]) AS x(raw) CROSS JOIN LATERAL(${sql.replaceAll('$KEY',key==='uuid'?'x.raw::uuid':'x.raw')}) v`;
};

function fromRows(direct:(name:Name,key:unknown)=>Promise<any[]>,today:()=>Promise<string>):DecorateLookups{
  const first=(name:Name)=>async(key:unknown)=>(await direct(name,key))[0];
  return {
    finalization:first('finalization'),
    quotationRevision:first('quotationRevision'),
    latestQuotation:first('latestQuotation'),
    latestPricing:first('latestPricing'),
    today,
    quotationStatus:first('quotationStatus'),
    shared:first('shared'),
    headsup:first('headsup'),
    readyGroupCount:first('readyGroupCount'),
    surveyPackage:first('surveyPackage'),
    references:key=>direct('references',key),
  };
}

export function directDecorateLookups(c:Db):DecorateLookups{
  return fromRows(async(name,key)=>(await c.query(directSql(name),[key])).rows,async()=>(await c.query(todaySql)).rows[0].today);
}

// Lookups requested while records are being decorated together are collected
// and sent as one query per kind of lookup. Each record still receives its own
// copy of the same rows the direct query returns.
//
// Queries run in waves: every record waits until the whole wave has finished,
// so records move together and the number of queries does not depend on how
// fast the database answers.
export function batchedDecorateLookups(c:Db):DecorateLookups{
  const direct=directDecorateLookups(c);
  type Job=()=>Promise<()=>void>;
  const queued=new Map<string,Job>();
  let scheduled=false;
  const flush=async()=>{
    scheduled=false;
    const jobs=[...queued.values()];queued.clear();
    for(const settle of await Promise.all(jobs.map(job=>job())))settle();
  };
  const enqueue=(id:string,job:Job)=>{
    queued.set(id,job);
    if(!scheduled){scheduled=true;setImmediate(()=>void flush());}
  };
  const loaders=new Map<Name,(key:unknown)=>Promise<any[]>>();
  const loader=(name:Name)=>{
    let found=loaders.get(name);
    if(found)return found;
    const cache=new Map<string,Promise<any[]>>();
    let pending:Map<string,{resolve:(rows:any[])=>void;reject:(error:unknown)=>void}>|null=null;
    const run:Job=async()=>{
      const batch=pending!;pending=null;
      try{
        const grouped=new Map<string,any[]>();
        for(const {pz_lookup_key,...row} of (await c.query(batchSql(name),[[...batch.keys()]])).rows){
          const rows=grouped.get(pz_lookup_key)??[];rows.push(row);grouped.set(pz_lookup_key,rows);
        }
        return()=>{for(const [key,waiter] of batch)waiter.resolve(grouped.get(key)??[]);};
      }catch(error){return()=>{for(const waiter of batch.values())waiter.reject(error);};}
    };
    found=(key:unknown)=>{
      // Comparing with a missing value matches no rows, so no query is needed; a count is simply zero.
      if(key===null||key===undefined)return Promise.resolve(name==='readyGroupCount'?[{n:'0'}]:[]);
      const raw=String(key);
      let rows=cache.get(raw);
      if(!rows){
        rows=new Promise<any[]>((resolve,reject)=>{
          if(!pending){pending=new Map();enqueue(name,run);}
          pending.set(raw,{resolve,reject});
        });
        cache.set(raw,rows);
      }
      return rows.then(list=>list.map(row=>({...row})));
    };
    loaders.set(name,found);
    return found;
  };
  let today:Promise<string>|undefined;
  const loadToday=()=>today??=new Promise<string>((resolve,reject)=>enqueue('today',async()=>{
    try{const value=await direct.today();return()=>resolve(value);}
    catch(error){return()=>reject(error);}
  }));
  return fromRows((name,key)=>loader(name)(key),loadToday);
}
