import {isArchivedLegacySolar} from './legacy-solar-archive.js';
/** Owner's active-work list rule. Records and document access stay intact. */
export function showOperationsSite(site:{id:string;program?:unknown;customer?:unknown;projectType?:unknown;completed?:boolean;stage:string;installation:boolean|null;qc?:Record<string,unknown>}){
 if(isArchivedLegacySolar(site))return false;
 if(/\blegacy\b/i.test(String(site.program??'')))return false;
 const completed=site.completed||site.qc?.signoff||site.qc?.handover||site.stage==='completed'||site.stage==='delivered'&&site.installation===false;
 const customer=String(site.customer??'').toLowerCase().replace(/[^a-z]/g,'');
 const ubl=customer==='ubl'||customer==='unitedbanklimited'||site.id.startsWith('registered-UBL:SOLAR:');
 return !completed||ubl&&['solar','solar-bess'].includes(String(site.projectType));
}
