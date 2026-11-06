import {Decimal} from 'decimal.js';
const normalize=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').replace(/\s*([:(),])\s*/g,'$1').toLowerCase();
/** Operations demand follows physical stock identity, rather than installation row labels. */
export function mergeOperationsMaterials(items:any[]){
 const totals=new Map<string,any>();
 const colour=(item:any)=>item.colour??(/DC.*Cable|DC cable/i.test(String(item.rateKey??item.description??''))?(/\bred\b/i.test(item.description??item.rateKey)?'Red':/\bblack\b/i.test(item.description??item.rateKey)?'Black':null):null);
 for(const item of items){
  const brands=(item.approvedBrands??[item.brand]).map(normalize).sort();
  const key=JSON.stringify([item.itemId??item.key,normalize(item.stockSpecification||item.specification),brands,normalize(item.unit),colour(item),item.itemId?null:normalize(item.description)]);
  const previous=totals.get(key);
  totals.set(key,{...previous,...item,colour:colour(item),qty:new Decimal(previous?.qty??0).plus(item.qty).toString(),specificationReview:previous?.specificationReview??item.specificationReview});
 }
 const rows=[...totals.values()];
 // Shared red/black IDs use the whole stock demand when checking available balance.
 for(const row of rows)row.stockDemandQty=row.itemId?rows.filter(other=>other.itemId===row.itemId&&normalize(other.unit)===normalize(row.unit)).reduce((sum,other)=>sum.plus(other.qty),new Decimal(0)).toString():row.qty;
 return rows;
}
/** Display projection only: an advance BOQ never consumes or reserves physical stock. */
export function operationsStockStatus(item:any){
 if(item.category==='Solar Panels'&&(!item.itemId||item.approvedBrands?.length!==1))return{available:null,balance:null,tone:'pending' as const,label:'Confirm Stock',confirmStock:true};
 const stock=item.stock;
 if(!stock||stock.available===null||stock.available===undefined||stock.available===''||normalize(stock.unit)!==normalize(item.unit))return{available:null,balance:null,tone:'pending' as const,label:'Stock not connected',confirmStock:false};
 const available=new Decimal(stock.available),balance=available.minus(item.stockDemandQty??item.qty);
 const minimum=stock.minimum===null||stock.minimum===undefined||stock.minimum===''?null:new Decimal(stock.minimum);
 return{available:available.toString(),balance:balance.toString(),tone:(balance.lt(0)?'danger':minimum!==null&&balance.lt(minimum)?'warning':minimum===null?'pending':'success') as 'danger'|'warning'|'pending'|'success',label:balance.lt(0)?'⚠ Shortfall':minimum!==null&&balance.lt(minimum)?'⚠ Below minimum':minimum===null?'Minimum not set':'Stock sufficient',confirmStock:false};
}

/** Exclude work/allowances; mapped earthing cable remains a physical stock item. */
export function isOperationsStockItem(item:any){
 if(item.category==='Structure')return false;
 if(item.category==='Solar Panels')return true;
 return !!item.itemId&&!/^(LS|JOB|W costing basis)$/i.test(String(item.unit??'').trim());
}
