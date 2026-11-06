import {InventorySheet} from './InventorySheet.js';
type TemporaryType='IGP'|'OGP'|'TRF'|'IRR'|'OTHER';
export type TemporarySheetDocument={number:string;type:TemporaryType;date:string;warehouse:string;party:string;sourceReference:string;actualReference:string;notes:string;detailsConfirmed:boolean;lines:{itemId:string;description:string;quantity:string;unit:string;remarks:string}[]};
const titles:Record<TemporaryType,string>={IGP:'Inwards Gate Pass',OGP:'Outwards Gate Pass',TRF:'Stock Transfer',IRR:'Inventory Return Record',OTHER:'Inventory Document'};
const parties:Record<TemporaryType,string>={IGP:'Supplier / source',OGP:'Site / destination',TRF:'Destination',IRR:'Returned from site',OTHER:'Supplier / site / destination'};
const signatures:Record<TemporaryType,[string,string]>={IGP:['Delivered by','Received by storekeeper'],OGP:['Issued by','Received by'],TRF:['Dispatched by','Received by'],IRR:['Returned by','Warehouse received by'],OTHER:['Prepared by','Verified by']};
// Same copy sets as the issued documents: DO for site delivery, warehouse transfer copies for transfers.
const copies:Record<TemporaryType,{name:string;note:string}[]>={OGP:[{name:'Customer copy',note:'Customer receipt and signature'},{name:'Gate copy',note:'Stock taker signs on receipt'},{name:'Handover evidence',note:'Customer handover confirmation'},{name:'Storekeeper copy',note:'Stock taker signs on receipt'}],TRF:[{name:'Storekeeper copy',note:'Dispatching storekeeper signs'},{name:'Gate copy',note:'Gate checks the outgoing material'},{name:'Receiving warehouse copy',note:'Receiving storekeeper signs on receipt'}],IGP:[{name:'Gate copy',note:'Gate checks the incoming material'},{name:'Storekeeper copy',note:'Stock taker signs on receipt'}],IRR:[{name:'Gate copy',note:'Gate checks the returned material'},{name:'Storekeeper copy',note:'Stock taker signs on receipt'}],OTHER:[{name:'Storekeeper copy',note:'Inventory record'}]};
const blank='To be entered';
/** Temporary document in the approved material-DO sheet layout, with its own content. */
export function TemporaryDocumentSheet({doc}:{doc:TemporarySheetDocument}){
 const type=doc.type in titles?doc.type:'OTHER';
 return <InventorySheet copies={copies[type]} title={titles[type]} number={doc.number} site={doc.party} notes={doc.notes} signatures={signatures[type]}
  footerNote="temporary reference for tracking only; it does not replace the final approved document reference"
  details={[{label:parties[type],value:doc.party||blank},{label:'Warehouse',value:doc.warehouse||blank},{label:'Document date',value:doc.date||blank},{label:'Related PO / IPO / reference',value:doc.sourceReference||blank},{label:'Actual document reference',value:doc.actualReference||'Not yet issued'}]}
  rows={doc.lines.map(l=>({id:l.itemId,name:l.description,unit:l.unit,quantity:l.quantity,remarks:l.remarks}))}/>;
}
