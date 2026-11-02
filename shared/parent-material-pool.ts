import {materialDocumentPolicy} from './material-documents.js';
/** Parent variable materials are a shared team pool. Old BOQ-derived site lists
 * are not allocations of warehouse OUT. Resolve availability for usage/VSO only;
 * preserve original dispatch snapshots, line keys, quantities and stock events. */
export function parentPoolLines<T extends {itemId:string;description:string;sites:string[]}>(snapshot:{parent:boolean;kind:string;sites:{siteId:string}[];lines:T[]}):T[]{
 if(!snapshot.parent||snapshot.kind!=='variable')return snapshot.lines;
 const sites=[...new Set(snapshot.sites.map(s=>s.siteId))];
 return snapshot.lines.map(row=>materialDocumentPolicy(row).variableDispatch?{...row,sites:[...sites]}:row);
}
