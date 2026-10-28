import type {WorkflowSite,FileReference} from '../../../server/operations-board/workflow.js';
export type Site=WorkflowSite&{version:number};
export type Access={qcDelegated?:boolean;kind:'owner'|'head'|'lead'|'qc';team:'central'|'south'|null;name:string};
export type Board={sites:Site[];access:Access};
export type Vendor={id:string;version:number;name:string;phone:string;roles:string[];active:boolean;internal?:boolean};
export type Evidence=FileReference;
export const normalise=(s:Site):Site=>({...s,history:s.history??[],accounts:s.accounts??[],blockers:s.blockers??[],planningBatches:s.planningBatches??[]});
export const bucket=(s:Site)=>s.completed||s.qc?.signoff||s.qc?.handover||s.stage==='delivered'&&s.installation===false?'completed':s.stage;
export const family=(s:Site)=>s.projectType??(/solar/i.test(String(s.type??''))?'solar-bess':/ups/i.test(String(s.type??''))?'ups':'bess');
export const teamName=(id:unknown)=>id==='central'?'Central Operations':id==='south'?'South Operations':'Not assigned';
export const stageNames={received:'Assign team & vendors',awaiting:'Awaiting delivery',delivered:'Delivered',completed:'Completed'};
export function day(value:unknown){if(typeof value!=='string'||!value)return 'Not recorded';const date=new Date(value.length===10?value+'T12:00:00+05:00':value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Karachi'}).format(date):'Not recorded';}
export const sitePath=(id:string)=>'/operations/sites/'+encodeURIComponent(id);
