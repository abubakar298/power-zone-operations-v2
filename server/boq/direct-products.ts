import {productBrandCategory} from './product-brand-category.js';
import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
import {findBess} from './bess.js';
import {singlePhaseConfigurations} from './equipment.js';
import type {Survey} from './schema.js';
import type {Masters,CostLine,BoqSnapshot} from './engine.js';
export function directProductGroups(s:Survey,m:Pick<Masters,'inverters'>) {
  if(!s.directProducts?.length)throw new HttpError(400,'Select at least one product or BESS package.');
  return s.directProducts.map((selection,index)=>{
    const quantity=new Decimal(selection.qty);
    if(quantity.lte(0))throw new HttpError(400,'Product quantities must be positive.');
    let components:{key:string;qty:string}[];
    if(selection.kind==='bess'){
      if(!quantity.isInteger())throw new HttpError(400,'BESS package quantities must be whole numbers.');
      const sp=singlePhaseConfigurations.find(c=>c.id===selection.key),hv=findBess(selection.key);
      if(!sp&&!hv)throw new HttpError(400,'Select an approved BESS ID.');
      const config=hv?m.inverters.find(i=>i.configuration===hv.inverter):undefined;
      if(hv&&!config)throw new HttpError(422,'BESS inverter configuration is unavailable.');
      components=[{key:sp?.inverterSku??config!.sku,qty:quantity.mul(sp?.inverterQty??hv!.inverterQty).toString()},{key:sp?.batterySku??'BAT-HV-05 KW WO BMS',qty:quantity.mul(sp?.batteryModules??hv!.batteryModules).toString()},{key:sp?.bmsSku??'CH-BMS-HV',qty:quantity.mul(sp?.bmsQty??hv!.bmsQty).toString()}];
    }else components=[{key:selection.key,qty:quantity.toString()}];
    return {id:`product-${index}`,package:selection.kind==='bess',label:selection.kind==='bess'?`BESS ID: ${selection.key.replace(/^BESS-/,'')}`:selection.key,quantity:quantity.toString(),brandId:selection.brandId,components};
  });
}
export function calculateDirectProducts(s:Survey,m:Masters):BoqSnapshot {
  const customer=m.customers.find(c=>c.id===s.customerId&&c.status==='Active');
  if(!customer)throw new HttpError(400,'Select an active customer.');
  const groups=directProductGroups(s,m),lines:CostLine[]=[],warnings:string[]=[];
  for(const group of groups)for(const component of group.components){
    const item=m.items.find(i=>i.key===component.key&&i.status!=='Inactive');
    const rate=m.rates.find(r=>r.key===component.key&&r.rate!==null&&r.status!=='Inactive');
    if(!item||!rate)throw new HttpError(422,`An active item and usable rate are required for ${component.key}.`);
    if(/^(Labour|Delivery|Misc\. Accessories|Earthing Bore|Structure -)/.test(component.key))throw new HttpError(400,'Select products only; installation and EPC services do not belong in Direct Product Sale.');
    const quantity=new Decimal(component.qty),bess=/^(HYB-|BAT-|CH-BMS-|BMS-)/.test(component.key);
    if((bess||/meter|MCB|MCCB/i.test(component.key))&&!/cable/i.test(component.key)&&!quantity.isInteger())throw new HttpError(400,`Use a whole quantity for ${component.key}.`);
    const brand=group.brandId?m.brands.find(b=>b.id===group.brandId&&b.status==='Active'&&b.category===productBrandCategory(component.key)):undefined;
    if(group.brandId&&!brand)throw new HttpError(400,'Select an active brand for this product category.');
    const existing=lines.find(l=>l.key===component.key);
    if(existing){if(existing.brand!==(brand?.name??''))throw new HttpError(400,'The same product cannot use different brands in one BOQ.');existing.qty=new Decimal(existing.qty).add(quantity).toString();existing.total=new Decimal(existing.qty).mul(existing.rate).toString();continue;}
    if(item.status!=='Approved'||!item.approved_specification)warnings.push(`${component.key}: approved specification requires review.`);
    if(rate.status==='Needs Rate')warnings.push(`${component.key}: rate marked Needs Rate; current numeric rate used.`);
    lines.push({key:component.key,description:component.key,brand:brand?.name??'',brandAlternatives:[],specification:s.specifications?.[component.key]??(item.status==='Approved'?item.approved_specification:null),specVersion:s.specifications?.[component.key]?null:item.version,qty:quantity.toString(),unit:rate.unit,rate:new Decimal(rate.rate!).toString(),rateVersion:rate.version,rateStatus:rate.status,total:quantity.mul(rate.rate!).toString(),phase:bess?'BESS':component.key==='Solar PV Modules'?'Solar Panels':'EPC',epc:''});
  }
  const total=lines.reduce((v,l)=>v.add(l.total),new Decimal(0));
  return {customer:{id:customer.id,name:customer.name,shortCode:customer.short_code},survey:s,selectedBrands:{},engineering:{pvWatts:'0',pvKwp:'0',strings:0,batteryModules:'0',bms:'0',bmsRuleVersion:'direct-product-equipment-v1',bmsPerInverter:'0',batteryPerInverter:'0',bessId:'PRODUCTS',solutionId:'DIRECT-PRODUCT'},lines,summary:['Solar Panels','BESS','EPC'].map(name=>({name,cost:lines.filter(l=>l.phase===name).reduce((v,l)=>v.add(l.total),new Decimal(0)).toString(),perWatt:'0.00'})),epc:[],total:total.toString(),perWatt:'0.00',warnings,rules:[],inverterConfig:{configuration:'Direct Product Sale',total_kw:'0',sku:'',quantity:1},classifications:m.classifications,directProductGroups:groups,engineVersion:1};
}
