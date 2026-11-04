import {InventorySheet} from './InventorySheet.js';
import {decimalDisplay} from '../numbers.js';
type CaseSnapshot={batch?:{reference:string;index:number;count:number};warehouse:string;original:{number:string;itemId:string;unit:string;description:string;quantity:string;serial:string|null};sites:{siteName:string;ipo:string}[];replacementQuantity:string;expectedOriginalReturnQuantity:string|null;reason:string};
export type ReplacementSheetCase={id:string;created_at?:string;snapshot:CaseSnapshot};
const qty=(v:string|null|undefined)=>v==null?'':decimalDisplay(v,2).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
/** Replacement case (one or several items of one original DO) in the approved sheet layout. */
export function ReplacementCaseSheet({cases}:{cases:ReplacementSheetCase[]}){
 const first=cases[0].snapshot,number=first.batch?.reference??'RPL-'+cases[0].id.slice(0,8).toUpperCase();
 const sites=[...new Set(first.sites.map(s=>s.siteName+(s.ipo?' · '+s.ipo:'')))].join(' / ')||'Site not verified';
 const opened=cases[0].created_at?String(cases[0].created_at).slice(0,10):'';
 return <InventorySheet title="Replacement Case" number={number} site={sites} quantityLabel="Replacement qty" notes={first.reason} signatures={['Prepared by','Approved by']}
  footerNote="replacement case record; stock moves only on the replacement DO and the signed faulty-return IGP"
  details={[{label:'Original DO',value:first.original.number},{label:'Site / IPO',value:sites},{label:'Replacement OUT warehouse',value:first.warehouse},{label:'Date opened',value:opened||'—'},{label:'Items',value:String(cases.length)}]}
  rows={cases.map(c=>{const s=c.snapshot;return {id:s.original.itemId,name:s.original.description,unit:s.original.unit,quantity:qty(s.replacementQuantity),remarks:[`On DO ${qty(s.original.quantity)}`,s.expectedOriginalReturnQuantity!=null?`Return expected ${qty(s.expectedOriginalReturnQuantity)}`:'Return qty unverified',s.original.serial?`Serial ${s.original.serial}`:''].filter(Boolean).join(' · ')};})}/>;
}
