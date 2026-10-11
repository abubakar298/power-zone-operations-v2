import {Decimal} from 'decimal.js';
import {HttpError} from '../http/errors.js';
const D=(v:any)=>new Decimal(v);
const rounded=(v:Decimal)=>v.toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
const fixed=(v:Decimal)=>rounded(v).toFixed(2);
const names=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
export function ublIpoSample(site:any){
 if(site.status!=='Active'||!site.baseline)throw new HttpError(422,'An active PO and agreed baseline are required.');
 const b=site.baseline, costs=names.map(()=>D(0));
 for(const i of b.items){const phase=i.item==='Solar panels'?0:i.item==='Elevated structure'?1:/^HYB-/.test(i.item)?2:/battery$/i.test(i.item)?3:/^HV BMS$/.test(i.item)?4:5;costs[phase]=costs[phase].add(i.total_ex_gst);}
 const cost=costs.reduce((v,c)=>v.add(c),D(0));
 if(!cost.eq(b.budgetedCost))throw new HttpError(422,'Saved item costs do not reconcile.');
 const total=rounded(D(b.sellingIncludingGst)),panel=rounded(D(b.commercialEvidence.panelSellingExcludingGst)),panelTax=rounded(panel.mul('0.10'));
 const installationPayable=total.sub(panel).sub(panelTax),installationSelling=rounded(installationPayable.div('1.18')),installationTax=installationPayable.sub(installationSelling);
 const remainingCost=cost.sub(costs[0]);if(!remainingCost.gt(0))throw new HttpError(422,'Installation phase costs are unavailable.');
 let allocatedSelling=D(0),allocatedTax=D(0);
 const phases=names.map((name,index)=>{
  const selling=index===0?panel:index===5?installationSelling.sub(allocatedSelling):rounded(installationSelling.mul(costs[index]).div(remainingCost));
  const tax=index===0?panelTax:index===5?installationTax.sub(allocatedTax):rounded(selling.mul('0.18'));
  if(index>0){allocatedSelling=allocatedSelling.add(selling);allocatedTax=allocatedTax.add(tax);}
  return {name,budgetedCost:fixed(costs[index]),sellingExcludingGst:fixed(selling),gst:fixed(tax),payable:fixed(selling.add(tax)),markup:fixed(selling.sub(costs[index]))};
 });
 if(!phases.reduce((v,p)=>v.add(p.payable),D(0)).eq(total))throw new HttpError(422,'PT phases do not reconcile with the approved PO.');
 const net=panel.add(installationSelling);
 return {version:1,purpose:site.documentStatus??'Review sample only - not issued or sent to Accounts',documentStatus:site.documentStatus??'Review sample',agreedWatts:site.agreedWatts??null,panelSellingRate:site.panelSellingRate??null,siteName:site.site_name,branchCode:site.branch_code,region:site.region,mainCity:site.main_city,legacyIpoNumber:site.legacy_ipo_number,poNumber:site.po_number,poIssuedDate:site.po_issued_date,configuration:site.configuration_id,pricingStage:site.pricing_stage,customer:'United Bank Limited (UBL)',billing:[{name:'Solar Panels',sellingExcludingGst:fixed(panel),gstRate:'10%',gst:fixed(panelTax),payable:fixed(panel.add(panelTax))},{name:'Installations',sellingExcludingGst:fixed(installationSelling),gstRate:'18%',gst:fixed(installationTax),payable:fixed(installationPayable)}],phases,totalSellingExcludingGst:fixed(net),totalGst:fixed(total.sub(net)),totalPayable:fixed(total),budgetedCost:fixed(cost),markupAmount:fixed(net.sub(cost)),markupPercent:net.sub(cost).div(cost).mul(100).toFixed(2),installationMarkupPercent:installationSelling.sub(remainingCost).div(remainingCost).mul(100).toFixed(6),allocationPolicy:'Panel selling amount is locked to the agreed pricing stage. Installation selling is allocated in proportion to saved non-panel phase costs, using one common markup percentage. EPC absorbs rounding only. GST-inclusive total remains exactly the approved PO amount.',reviewNotes:b.reviewNotes};
}
