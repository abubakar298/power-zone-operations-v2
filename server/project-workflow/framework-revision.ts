import {randomUUID} from 'node:crypto';import {Decimal} from 'decimal.js';import {z} from 'zod';import {transaction} from '../db/transaction.js';import {frameworkBasis} from './basis.js';import {allocateReference} from '../documents/references.js';import {HttpError} from '../http/errors.js';
export async function revisionSource(repo:any,actor:string,id:string){return transaction(repo.pool,async(c:any)=>{
 await c.query('SELECT pg_advisory_xact_lock(742019004)');const {u,r}=await repo.record(actor,id,c,true);repo.requireRole(u,['Coordinator']);
 const rule=(await c.query("SELECT * FROM workflow_revision_source_rules WHERE customer_short_code=$1 AND route=$2 ORDER BY version DESC LIMIT 1",[r.short_code,r.route])).rows[0];
 if(!rule||!r.framework_id||!r.data.designHandoffAt)throw new HttpError(422,'A technically reviewed survey and approved pre-agreed configuration are required.');
 const prior=(await c.query('SELECT s.*,b.number FROM framework_revision_sources s JOIN boq_revisions b ON b.id=s.boq_revision_id WHERE s.record_id=$1 AND s.record_version=$2',[id,r.version])).rows[0];if(prior)return dto(prior);
 const review=(await c.query("SELECT snapshot FROM project_workflow_documents WHERE record_id=$1 AND kind='Technical review' ORDER BY version DESC LIMIT 1",[id])).rows[0]?.snapshot;
 const basis=r.data.basis??await frameworkBasis(repo.pool,c,r,r.framework_id);
 const survey={...basis.boq.survey,...(review?.enteredSurvey??r.data.surveyInputs),customerId:r.customer_id,siteName:r.site_name,siteCode:r.site_code,preparedBy:u.display_name,uploadIds:[],ocrText:'',ocrReviewed:true};
 if(!survey.bessId)throw new HttpError(422,'The saved technical solution is incomplete.');
 const snapshot={...structuredClone(basis.boq),customer:{id:r.customer_id,name:r.customer,shortCode:r.short_code},survey,frameworkRevisionBasis:{source:basis.source,order:basis.order??basis.orderSnapshot,commercial:basis.commercial??null},frameworkOriginalBoq:basis.boq};
 const phaseAmounts=Object.fromEntries((basis.order.peachtree?.phases??[]).map((p:any)=>[p.name,p.amount]));
 const beforeTax={solar:phaseAmounts['Solar Panels']??'0',structure:phaseAmounts.Structure??'0',bess:new Decimal(phaseAmounts.Inverter??'0').plus(phaseAmounts.Batteries??'0').plus(phaseAmounts.BMS??'0').toString(),earthing:'0',balance:phaseAmounts.EPC??'0'};
 if(!new Decimal(Object.values(beforeTax).reduce((sum:any,value:any)=>new Decimal(sum).plus(value).toString(),'0')).eq(basis.order.allocation.subtotal))throw new HttpError(422,'The approved pre-agreed selling allocation does not reconcile.');
 const groupCost={solar:snapshot.summary.find((p:any)=>p.name==='Solar Panels')?.cost??'0',structure:snapshot.summary.find((p:any)=>p.name==='Structure')?.cost??'0',bess:snapshot.summary.find((p:any)=>p.name==='BESS')?.cost??'0',earthing:'0',balance:snapshot.summary.find((p:any)=>p.name==='EPC')?.cost??'0'};
 const markups=Object.fromEntries(Object.entries(beforeTax).map(([key,value])=>[key,new Decimal((groupCost as any)[key]).isZero()?'0':Decimal.max(0,new Decimal(String(value)).div((groupCost as any)[key]).minus(1).mul(100)).toFixed(6)]));
 Object.assign(snapshot,{frameworkPricing:{beforeTax,markups,source:basis.source}});
 const sourceId=randomUUID(),draft=randomUUID(),boq=randomUUID(),revision=randomUUID();const number=await allocateReference(c,'PBQ',boq,r.customer_id,r.site_code);
 await c.query('INSERT INTO survey_drafts(id,owner_id,inputs) VALUES($1,$2,$3)',[draft,actor,survey]);
 await c.query('INSERT INTO boqs(id,draft_id,site_id,customer_id,sequence,created_by) SELECT $1,$2,$3,$4,COALESCE(max(sequence),0)+1,$5 FROM boqs WHERE site_id=$3 AND customer_id=$4',[boq,draft,r.site_id,r.customer_id,actor]);
 await c.query("INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by,revision_reason) VALUES($1,$2,0,$3,$4,$5,'Pre-agreed survey revision source')",[revision,boq,number,snapshot,actor]);
 await c.query('INSERT INTO boq_draft_finalizations(draft_id,revision_id) VALUES($1,$2)',[draft,revision]);
 const row=(await c.query('INSERT INTO framework_revision_sources(id,record_id,record_version,framework_id,boq_revision_id,rule_version,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[sourceId,id,r.version,r.framework_id,revision,rule.version,{basis,survey,frameworkPricing:snapshot.frameworkPricing},actor])).rows[0];
 await c.query('INSERT INTO audit_log(user_id,action) VALUES($1,$2)',[actor,`framework.revision-source:${sourceId}:${number}`]);return dto({...row,number});
});}
function dto(row:any){return{id:row.id,boq_revision_id:row.boq_revision_id,number:row.number,record_version:row.record_version,framework_id:row.framework_id,sourceType:'pre-agreed',rule_version:row.rule_version,pricingInput:{boqRevisionId:row.boq_revision_id,presentation:'Basic Breakup',taxMode:'Show Sales Tax Separately',saleType:'Tax Deal',discountMode:'Custom',discountPercent:'0',markups:{...row.snapshot.frameworkPricing.markups,rest:row.snapshot.frameworkPricing.markups.balance},remarks:'Pre-agreed UBL rates retained from the approved configuration.'}};}
export async function configurationChoices(repo:any,actor:string,id:string){const {u,r}=await repo.record(actor,id);repo.requireRole(u,['Coordinator']);return(await repo.pool.query("SELECT id,configuration_key,payload->'commercial'->>'totalIncludingGst' AS total FROM project_framework_current WHERE customer_id=$1 AND payload->>'type'='ubl-solar' AND payload->>'pricingStage'='Revised' AND payload->'routes' ? $2 ORDER BY configuration_key",[r.customer_id,r.route])).rows;}
function fixedSnapshot(basis:any){
 const snapshot={...structuredClone(basis.boq),frameworkRevisionBasis:{source:basis.source,order:basis.order},frameworkOriginalBoq:basis.boq};
 const phases=Object.fromEntries(basis.order.peachtree.phases.map((p:any)=>[p.name,p.amount]));
 const beforeTax={solar:phases['Solar Panels']??'0',structure:phases.Structure??'0',bess:new Decimal(phases.Inverter??'0').plus(phases.Batteries??'0').plus(phases.BMS??'0').toString(),earthing:'0',balance:phases.EPC??'0'};
 if(!new Decimal(Object.values(beforeTax).reduce((sum,value)=>new Decimal(sum).plus(value).toString(),'0')).eq(basis.order.allocation.subtotal))throw new HttpError(422,'Approved allocation does not reconcile.');
 const groups:any={solar:'Solar Panels',structure:'Structure',bess:'BESS',balance:'EPC'};
 const markups=Object.fromEntries(Object.entries(beforeTax).map(([key,value])=>{const cost=snapshot.summary.find((r:any)=>r.name===groups[key])?.cost??'0';return[key,new Decimal(cost).isZero()?'0':Decimal.max(0,new Decimal(value).div(cost).minus(1).mul(100)).toFixed(6)];}));
 return{...snapshot,frameworkPricing:{beforeTax,markups,source:basis.source,fixed:true}};
}
export async function startFrameworkRevision(repo:any,actor:string,id:string,raw:unknown){const v=z.object({sourceId:z.uuid(),route:z.literal('technical'),frameworkId:z.uuid(),origin:z.enum(['Internal management','Customer']),reason:z.string().trim().min(1).max(2000),requestedBy:z.string().trim().min(1).max(200),requestKey:z.uuid()}).strict().parse(raw);return transaction(repo.pool,async(c:any)=>{
 await c.query('SELECT pg_advisory_xact_lock(742019004)');const {u,r}=await repo.record(actor,id,c,true);repo.requireRole(u,['Coordinator']);await repo.requireReceivingDepartment(u,r,c);
 const prior=(await c.query('SELECT * FROM framework_revision_requests WHERE request_key=$1',[v.requestKey])).rows[0];if(prior){const saved=(await c.query('SELECT * FROM framework_configuration_revisions WHERE request_id=$1',[prior.id])).rows[0];if(prior.created_by!==actor||prior.source_id!==v.sourceId||prior.reason!==v.reason||prior.origin!==v.origin||prior.requested_by!==v.requestedBy||saved?.target_framework_id!==v.frameworkId)throw new HttpError(409,'Request key already used.');return configuredResult(c,prior.id);}
 const source=(await c.query('SELECT * FROM framework_revision_sources WHERE id=$1 AND record_id=$2',[v.sourceId,id])).rows[0];if(!source||source.record_version!==r.version)throw new HttpError(409,'The survey changed. Reload its revision source.');
 const choice=(await c.query("SELECT id FROM project_framework_current WHERE id=$1 AND customer_id=$2 AND payload->>'type'='ubl-solar' AND payload->>'pricingStage'='Revised'",[v.frameworkId,r.customer_id])).rows[0];if(!choice)throw new HttpError(422,'Select a final approved UBL configuration.');
 const basis=await frameworkBasis(repo.pool,c,r,v.frameworkId),snapshot=fixedSnapshot(basis);
 const base=(await c.query('SELECT * FROM boq_revisions WHERE id=$1',[source.boq_revision_id])).rows[0];const version=(await c.query('SELECT COALESCE(max(revision),0)+1 AS n FROM boq_revisions WHERE boq_id=$1',[base.boq_id])).rows[0].n;
 const revision=randomUUID(),request=randomUUID(),number=base.number+'-R'+version;
 await c.query('INSERT INTO boq_revisions(id,boq_id,revision,number,snapshot,created_by,revision_reason,revision_origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[revision,base.boq_id,version,number,snapshot,actor,v.reason,v.origin]);
 await c.query('INSERT INTO framework_revision_requests(id,source_id,route,origin,reason,requested_by,created_by,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[request,source.id,v.route,v.origin,v.reason,v.requestedBy,actor,v.requestKey]);
 await c.query('INSERT INTO framework_configuration_revisions(request_id,target_framework_id,boq_revision_id,snapshot) VALUES($1,$2,$3,$4)',[request,v.frameworkId,revision,{previousFrameworkId:source.framework_id,selectedFrameworkId:v.frameworkId,solutionId:basis.order.solutionId,order:basis.order,basis,ruleVersion:2}]);
 await repo.document(c,r,actor,'Framework revision request',{...v,boqRevisionId:revision,solutionId:basis.order.solutionId,ruleVersion:2});
 return configuredResult(c,request);
});}
async function configuredResult(c:any,id:string){const row=(await c.query('SELECT r.*,b.number,b.snapshot FROM framework_configuration_revisions r JOIN boq_revisions b ON b.id=r.boq_revision_id WHERE r.request_id=$1',[id])).rows[0];return{id,boq_revision_id:row.boq_revision_id,pricingInput:dto({boq_revision_id:row.boq_revision_id,snapshot:row.snapshot}).pricingInput};}
