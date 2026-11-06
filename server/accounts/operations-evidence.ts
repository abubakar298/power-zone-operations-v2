import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {workflowSiteSchema,type Entry} from '../operations-board/workflow.js';
import {HttpError} from '../http/errors.js';

type Client=Pool|PoolClient;
export type OperationsEvidenceSource={kind:'Operations';boardSiteId:string;version:number;fileId:string;sha256:string;date:string;purpose:'acknowledgement'|'irr'|'variable-signoff'|'qc-photo'};
export type OperationsClosureEvidence={id:string;job_key:string;kind:'Client acknowledgment'|'IRR'|'Variable items sign-off'|'Site photographs';filename:string;media_type:string;sha256:string;created_at:Date;created_by:string;downloadUrl:string;source:OperationsEvidenceSource};
export type OperationsClosureProjection={evidence:OperationsClosureEvidence[];signature:string|null;source:{boardSiteId:string;version:number}|null;hold?:string};
const fileId=z.uuid(),date=z.iso.date();
const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/heic','image/heif']);
function actualImage(type:string,header:Buffer){
 if(type==='image/png')return header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(type==='image/jpeg')return header[0]===255&&header[1]===216&&header[2]===255;
 if(type==='image/webp')return header.subarray(0,4).toString()==='RIFF'&&header.subarray(8,12).toString()==='WEBP';
 if(!['image/heic','image/heif'].includes(type)||header.length<16||header.subarray(4,8).toString()!=='ftyp')return false;
 const length=header.readUInt32BE(0);if(length<16||length>4096||length>header.length)return false;
 const brands=[header.subarray(8,12).toString()];for(let i=16;i+4<=length;i+=4)brands.push(header.subarray(i,i+4).toString());
 return brands.some(b=>['heic','heix','hevc','hevx','heim','heis','mif1','msf1'].includes(b));
}
async function project(c:Client,jobKey:string,options:{lock?:boolean;version?:number}={}):Promise<OperationsClosureProjection>{
 const match=/^ipo:(.+)$/.exec(jobKey),ipo=match&&fileId.safeParse(match[1]);
 const held=(hold:string,source:OperationsClosureProjection['source']=null):OperationsClosureProjection=>({evidence:[],signature:null,source,hold});
 if(!ipo||!ipo.success)return held('This historical job has no exact approved IPO-to-Operations source link.');
 if(options.lock&&typeof (c as PoolClient).release!=='function')throw new Error('Operations evidence locking requires the caller transaction client.');
 const link=(await c.query(`SELECT l.board_site_id FROM inventory_material_source_links l JOIN operations_board_sites s ON s.id=l.board_site_id WHERE l.ipo_id=$1${options.lock?' FOR SHARE OF s':''}`,[ipo.data])).rows[0];
 if(!link)return held('The approved IPO has no exact Operations source link.');
 const row=(await c.query(`SELECT version,snapshot FROM operations_board_versions WHERE site_id=$1${options.version!==undefined?' AND version=$2':''} ORDER BY version DESC LIMIT 1`,options.version!==undefined?[link.board_site_id,options.version]:[link.board_site_id])).rows[0];
 if(!row)return held('The linked Operations evidence version is unavailable.');
 const source={boardSiteId:link.board_site_id as string,version:row.version as number},parsed=workflowSiteSchema.safeParse(row.snapshot);
 if(!parsed.success)return held('The linked Operations record needs a valid typed QC completion before Accounts can reuse evidence.',source);
 const site=parsed.data;
 if(site.id!==source.boardSiteId)return held('The linked Operations snapshot identity needs verification.',source);
 if(site.installation!==true||site.scopePending||site.projectType==='delivery-only')return held('This record does not establish completed installation scope.',source);
 if(site.completed!==true)return held('Operations has not recorded installation completion.',source);
 const type=site.projectType;
 if(!type||!['solar','solar-bess','bess','ups'].includes(type))return held('The installation project type needs explicit verification.',source);
 const stageNames=type==='ups'?['job']:type==='bess'?['cabinet','panel','bessTesting','handover']:['civil','electrical','testing','signoff'];
 const entries=stageNames.map(stage=>({stage,entry:(stage==='job'?site.qcJob:site.qc?.[stage]) as Entry|undefined}));
 if(entries.some(e=>!e.entry))return held('The completed record lacks the applicable typed QC stages; historical document labels alone are insufficient.',source);
 const final=entries.at(-1)!.entry!;
 if(type==='ups'&&['mounting','electrical','testingTraining','signoff'].some(key=>(final.checks as Record<string,unknown>|undefined)?.[key]!==true))return held('The UPS completion checks are incomplete.',source);
 if(!final.acknowledgement||(!final.noVariableItemsUsed&&!final.variableSignoff))return held('Record the acknowledgement and variable-items sign-off, or confirm no variable items were used.',source);
 const typed=[{purpose:'acknowledgement' as const,kind:'Client acknowledgment' as const,ref:final.acknowledgement},{purpose:'irr' as const,kind:'IRR' as const,ref:final.irr},{purpose:'variable-signoff' as const,kind:'Variable items sign-off' as const,ref:final.variableSignoff}].filter(t=>!!t.ref);
 const documentIds=new Set(typed.map(t=>t.ref!.id));
 const candidates=entries.flatMap(({stage,entry})=>[entry!.evidence,...entry!.additionalEvidence??[]].filter((r):r is NonNullable<typeof r>=>!!r).map(ref=>({stage,date:entry!.date,id:ref.id})));
 const references=[...typed.map(t=>t.ref!.id),...candidates.map(p=>p.id)];
 const ids=[...new Set(references)];
 const files=(await c.query('SELECT id,filename,media_type,sha256,created_at,created_by,substring(content from 1 for 4096) AS header FROM operations_board_files WHERE site_id=$1 AND id=ANY($2::uuid[])',[source.boardSiteId,ids])).rows;
 if(files.length!==ids.length)return held('A required QC file is missing or belongs to another site.',source);
 const byId=new Map<string,any>(files.map(f=>[f.id,f]));
 // A signature scan remains a sign-off, never a photograph of the installed site.
 const photos=candidates.filter(p=>!documentIds.has(p.id)&&imageTypes.has(byId.get(p.id).media_type)&&actualImage(byId.get(p.id).media_type,byId.get(p.id).header));
 if(!photos.length)return held('Upload an actual QC site photograph; PDFs and customer signature scans do not establish site photographs.',source);
 const evidence:OperationsClosureEvidence[]=[];
 const add=(id:string,kind:OperationsClosureEvidence['kind'],purpose:OperationsEvidenceSource['purpose'],when:string)=>{
  const f=byId.get(id),ref:OperationsEvidenceSource={kind:'Operations',...source,fileId:id,sha256:f.sha256,date:when,purpose};
  evidence.push({id,job_key:jobKey,kind,filename:f.filename,media_type:f.media_type,sha256:f.sha256,created_at:f.created_at,created_by:f.created_by,downloadUrl:`/api/accounts-workspace/jobs/${encodeURIComponent(jobKey)}/operations-evidence/${source.version}/${id}`,source:ref});
 };
 for(const item of typed)add(item.ref!.id,item.kind,item.purpose,final.date);
 for(const p of photos.filter((p,index,all)=>all.findIndex(other=>other.id===p.id)===index))add(p.id,'Site photographs','qc-photo',p.date);
 const signature=createHash('sha256').update(JSON.stringify({boardSiteId:source.boardSiteId,type,completed:true,installation:true,...final.noVariableItemsUsed?{noVariableItemsUsed:true}:{},completion:entries.map(({stage,entry})=>({stage,date:entry!.date,...type==='ups'?{checks:entry!.checks}:{}})),documents:typed.map(t=>({purpose:t.purpose,id:t.ref!.id,sha256:byId.get(t.ref!.id).sha256})),photos:photos.map(p=>({...p,sha256:byId.get(p.id).sha256})).sort((a,b)=>a.stage.localeCompare(b.stage)||a.id.localeCompare(b.id))})).digest('hex');
 return {evidence,signature,source};
}
/** Internal read projection. Caller must authorise Accounts job access. */
export async function projectOperationsClosureEvidence(c:Client,jobKey:string,options:{lock?:boolean}={}):Promise<OperationsClosureProjection>{return project(c,jobKey,options);}
/** Caller must separately allow a current source reference or a frozen closure reference. */
export async function operationsClosureEvidenceFile(c:Client,jobKey:string,source:OperationsEvidenceSource){
 if(source?.kind!=='Operations'||!fileId.safeParse(source.fileId).success||!Number.isSafeInteger(source.version)||source.version<1||!date.safeParse(source.date).success)throw new HttpError(404,'Operations evidence not found.');
 const projected=await project(c,jobKey,{version:source.version});
 const eligible=projected.evidence.some(e=>e.source.boardSiteId===source.boardSiteId&&e.id===source.fileId&&e.sha256===source.sha256&&e.source.date===source.date&&e.source.purpose===source.purpose);
 if(!eligible)throw new HttpError(404,'Operations evidence not found.');
 const row=(await c.query('SELECT filename,media_type,sha256,content,created_at,created_by FROM operations_board_files WHERE site_id=$1 AND id=$2',[source.boardSiteId,source.fileId])).rows[0];
 if(!row||createHash('sha256').update(row.content).digest('hex')!==source.sha256)throw new HttpError(404,'Operations evidence is unavailable or failed integrity verification.');
 return row as {filename:string;media_type:string;sha256:string;content:Buffer;created_at:Date;created_by:string};
}
