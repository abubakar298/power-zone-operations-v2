import {materialDocumentPolicy} from './material-documents.js';

/** Owner rule (Nov 2026): a site DO's paper lists fixed items only. Variable items
 * (cables, pipes, ducts, lugs, tape...) stay on the same DO record and leave stock
 * with it, so they print on a separate "Variable Material Gate Pass" under the same
 * DO number, which the gate signs too. Display only: records, stock and the VSO
 * keep using every DO line. A Parent DO and delivery-only sales are never split. */
export const variableGatePassTitle='Variable Material Gate Pass';
export const variableGatePassCopies=['Gate copy','Storekeeper copy'];
export const noFixedItemsText='No fixed items on this DO. Its variable items are on the Variable Material Gate Pass.';

type Row={itemId:string;description:string};
type Splittable={kind:string;rows:Row[];separateVariableItems?:boolean;title:string;signatures:string[];note:string;acknowledgements?:unknown[];emptyRowsText?:string;variableGatePass?:boolean};

export function splitDeliveryOrder<M extends Splittable>(model:M):M[]{
 if(model.kind!=='fixed-do'||!model.separateVariableItems)return [model];
 const variable=(row:Row)=>materialDocumentPolicy(row).variableDispatch;
 const fixed:M={...model,separateVariableItems:false,rows:model.rows.filter(row=>!variable(row)),...(model.rows.every(variable)?{emptyRowsText:noFixedItemsText}:{})};
 const variableRows=model.rows.filter(variable);
 if(!variableRows.length)return [fixed];
 return [fixed,{...model,kind:'variable-do',separateVariableItems:false,variableGatePass:true,title:variableGatePassTitle,rows:variableRows,acknowledgements:undefined,signatures:['Warehouse issued by','Site team received by'],note:'Variable items sent on the same DO as its fixed items. Sign this page at the gate together with the DO. Usage and returns are recorded on the Variable-Material Usage Sign-off. '+model.note}];
}
