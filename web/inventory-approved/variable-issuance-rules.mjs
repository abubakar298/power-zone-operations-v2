// Final installed quantities never create a second warehouse issue.
export const VARIABLE_IDS=new Set(['CH-Flex Pipe 1','CH-Pvc Pipe 1.5 Inch','CH-Duct Slot 100x100','CH-Duct Slot 60x60','CH-CABLE-TIES','CH-PVC-TAPE','CH-PVC-BENDS-SOCKETS','CH-PVC-MISC-ACC','CH-PVC-ELBOW','CH-Mix Items All','CH-MC4']);
export function isVariableItem(id,description=''){return VARIABLE_IDS.has(id)||/^CH-CBL-/.test(id)||/\b(cables?|ducts?|flex(?:ible)? pipes?|pvc pipes?|screws?|cable ties?|pvc tape|lugs?|thimbles?|MC4)\b/i.test(description);}
export function customerSigns(row){return isVariableItem(row.id,row.description||row.name||'');}
export function quantity(value){if(value===''||value===null||value===undefined)return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:NaN;}
const rounded=n=>Math.round(n*1e6)/1e6;
export function reconcileLine(row){
 const out=quantity(row.out),used=quantity(row.used),returned=quantity(row.returned);
 const extra=(row.sources||[]).filter(s=>['DO','LP'].includes(s.type)&&s.ref?.trim()&&quantity(s.qty)>0).reduce((n,s)=>n+Number(s.qty),0);
 if([out,used,returned].some(Number.isNaN))return{status:'Invalid quantity',balance:null,extra,ready:false};
 if(out===null||used===null)return{status:'Quantity pending',balance:null,extra,ready:false};
 const effectiveReturn=returned===null&&rounded(out+extra-used)===0?0:returned;
 if(effectiveReturn===null)return{status:'Return quantity pending',balance:null,extra,ready:false};
 const balance=rounded(out+extra-used-effectiveReturn);
 if(balance<0)return{status:'Additional DO / LP evidence needed',balance,extra,ready:false};
 if(balance>0)return{status:'Unused quantity awaiting accounting',balance,extra,ready:false};
 if(!row.ref?.trim()&&out>0)return{status:'Original dispatch evidence needed',balance,extra,ready:false};
 return{status:'Reconciled',balance,extra,ready:true};
}
export function customerRows(rows){return rows.filter(row=>customerSigns(row)&&quantity(row.used)>0);}
export function poolBalance(out,siteRows){const issued=quantity(out);if(issued===null||Number.isNaN(issued))return null;let left=issued;for(const row of siteRows){const used=quantity(row.used),returned=quantity(row.returned);if(used===null||returned===null||Number.isNaN(used)||Number.isNaN(returned))return null;left+= (row.sources||[]).filter(s=>s.type==='LP'&&s.ref?.trim()&&quantity(s.qty)>0).reduce((n,s)=>n+Number(s.qty),0)-used-returned;}return rounded(left);}
export function paginate(rows,size=19){return Array.from({length:Math.max(1,Math.ceil(rows.length/size))},(_,i)=>rows.slice(i*size,(i+1)*size));}
