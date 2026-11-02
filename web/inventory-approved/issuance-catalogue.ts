import {materialDocumentPolicy} from '../../shared/material-documents.js';
import stock from '../../data/final-stock-item-ids.json' with {type:'json'};
export const finalIssuanceItems=stock.rows.map(row=>({id:row.itemId,description:row.description,unit:row.units[0]||'',group:/solar panel/i.test(row.category)?'Solar Panels':/box/i.test(row.category)?'DBs & Enclosures':row.category}));
export const issuanceLookupItems=finalIssuanceItems;
export const variableExtra=(row:{id:string;description?:string})=>materialDocumentPolicy({itemId:row.id,description:row.description??''}).variableDispatch;
export const includedInUblBox=(project:{customer:string},id:string)=>/\bUBL\b|United Bank Limited/i.test(project.customer)&&id==='CH-SM-3P';

export function draftItemId(id:string,_description=''){const targets=stock.rows.filter((row:any)=>row.itemId===id||(row.oldAliases??[]).includes(id));return targets.length===1?targets[0].itemId:id;}
