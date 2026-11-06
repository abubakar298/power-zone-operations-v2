/** Presentation projection: approved scope/brands, without altering frozen demand quantities. */
const ublRows:Record<string,string>={
 'Solar PV Modules':'A1','Structure - Elevated':'B2','Structure - Flat Roof':'B2',
 'BAT-HV-05 KW WO BMS':'C4','CH-BMS-HV':'C4','DC Breaker':'D5',
 'DC Fuse with Holder':'D6','DC SPD':'D7','AC & DC Boxes':'BOX',
 '6mm² DC Cable Red':'D11R','6mm² DC Cable Black':'D11B','Misc. Accessories':'MISC',
 '100A 4P MCCB':'E15','63A 4P MCB':'E16','AC SPD':'E17',
 '16mm² 4C AC Cable':'E19','25mm² 4C AC Cable':'E20','Earthing Bore':'F24',
 '2.5mm² Earthing Cable':'F25','6mm² Earthing Cable':'F26','10mm² Earthing Cable':'F27',
 'Extra Smart Meter':'G27','UBL Internet':'H29'
};
function approvedRow(item:any,rows:any[]){
 const description=String(item.description??'');const key=String(item.rateKey??item.key??'');
 let id=ublRows[key];if(/^(HYB-|CH-PCS-)/.test(key))id='C3';
 if(/inverter room/i.test(description))id='D8';if(/^Output /i.test(description))id='E16';
 if(/Changeover/i.test(description)||/changeover/i.test(key))id='E18';
 if(/load cable/i.test(description))id='E20';
 return rows.find(row=>row.id===id);
}
export function materialCategory(item:any){
 const text=String(item.rateKey??item.key??item.description??'');
 if(/Solar PV|Solar panels/i.test(text))return 'Solar Panels';
 if(/Structure/i.test(text))return 'Structure';
 if(/HYB-|CH-PCS-|Inverter Hybrid/i.test(text))return 'Inverters';
 if(/BAT-|BMS|battery/i.test(text))return 'Batteries & BMS';
 if(/Earthing|earth /i.test(text))return 'Earthing';
 if(/Cable/i.test(text))return 'Cables';
 if(/DC Breaker|DC Fuse|DC SPD/i.test(text))return 'DC Protection';
 if(/MCCB|MCB|AC SPD|Changeover/i.test(text))return 'AC Protection';
 return 'Accessories';
}
export function approvedMaterialView(items:any[],technicalRows:any[]=[],boqLines:any[]=[]){return items.map(item=>{
 const sourceLine=boqLines.find(line=>line.itemId===item.itemId&&line.description===item.description)||boqLines.find(line=>line.key===item.rateKey&&line.description===item.description);
 const row=approvedRow(item,technicalRows);
 const fixedChintBrand=[item.brand,sourceLine?.brand].find(brand=>typeof brand==='string'&&/^chint(?: power)?$/i.test(brand.trim()));
 const approvedChintBrand=String(row?.brands??'').split('/').map(brand=>brand.trim()).find(brand=>/^chint(?: power)?$/i.test(brand));
 const rawBrands=fixedChintBrand??approvedChintBrand??row?.brands??(sourceLine?.brandAlternatives?.length?sourceLine.brandAlternatives:sourceLine?.brand??item.brand);
 const approvedBrands=Array.isArray(rawBrands)?rawBrands:String(rawBrands??'').split('/').map(s=>s.trim()).filter(Boolean);
 const component=/BMS|BAT-HV|HYB-|CH-PCS-/.test(String(item.rateKey??''));
 const stockSpecification=item.specification??'';
 const amps=(s:string)=>[...s.matchAll(/(\d+)\s*A\b/gi)].map(m=>m[1]);
 const stockAmps=amps(stockSpecification),approvedAmps=amps(row?.specification??'');
 const specificationReview=stockAmps.length&&approvedAmps.length&&stockAmps.some(value=>!approvedAmps.includes(value))?'Stock ID rating differs from approved BOQ — verify before allocation':null;
 return {...item,stockSpecification,specificationReview,category:materialCategory(item),approvedBrands,approvedBoqRowId:row?.id??null,
 specification:component?item.specification:(row?.specification||sourceLine?.specification||item.specification),
 itemId:item.itemId??sourceLine?.itemId??null,approvalMatched:!!row||!!sourceLine};
});}
