import {isArchivedLegacySolar} from './legacy-solar-archive.js';
/** Archive only the reviewed legacy Solar identities. Completion is a stage,
 * not an archive decision; team permissions remain enforced by the server. */
export function showOperationsSite(site:{id:string;program?:unknown;customer?:unknown;projectType?:unknown;completed?:boolean;stage:string;installation:boolean|null;qc?:Record<string,unknown>}){
 return !isArchivedLegacySolar(site);
}
