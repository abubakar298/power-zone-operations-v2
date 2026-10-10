import {Decimal} from 'decimal.js';
import {standardItemPrices,type CommercialPolicy,type PolicyCategory} from '../commercial/active-policy.js';
import type {BoqSnapshot,CostLine,Masters} from '../boq/engine.js';

const Exact=Decimal.clone({precision:50});
const D=(v:string)=>new Exact(v);
const money=(v:Decimal)=>v.toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
export interface UblScopeRow {id:string;description:string;brands:string;specification:string;unit:string;quantity:string;proposalSellingRate:string|null;proposalTax:string|null;proposalSellingTotal:string|null;bundle:string|null;deferred?:boolean;routeAllowance?:string}
export interface UblConfiguration {id:string;option:string;pvWatts:string;inverterKw:string;essKwh:string;source:{filename:string;sha256:string;proposalStageFinalTotal:string};originalBoq:UblScopeRow[];currentBoq:UblScopeRow[];currentTechnicalVersion:number;amendments:{date:null;dateLabel:string;notes:string}[];history:{stage:string;date:string;totalIncludingGst:string;panelSellingExcludingGst:string;historicalSummaryBudget:string;technicalVersion:number}[]}
export interface AllocationLine {id:string;cost:string;standardMarkupAmount:string;taxRate:string}
/** Scale monetary markup, never costs. Tax groups come from the existing policy engine. */
export function allocateRemaining(lines:AllocationLine[],availableIncludingTax:string){
 const available=D(availableIncludingTax),costGross=lines.reduce((n,l)=>n.add(D(l.cost).mul(D(l.taxRate).div(100).add(1))),D('0'));
 const poolGross=lines.reduce((n,l)=>n.add(D(l.standardMarkupAmount).mul(D(l.taxRate).div(100).add(1))),D('0'));
 if(available.lt(costGross))return {status:'Below cost',lines:[],factor:null,roundingAdjustment:null,unresolvedIncludingTax:money(available),reason:'Fixed selling value would require selling remaining scope below cost.'};
 if(poolGross.lte(0))return {status:'Zero markup pool',lines:[],factor:null,roundingAdjustment:null,unresolvedIncludingTax:money(available),reason:'No positive standard monetary markup pool is available.'};
 const factor=available.sub(costGross).div(poolGross);
 const adjusted=lines.map(l=>{const cost=D(l.cost),markup=D(l.standardMarkupAmount).mul(factor),selling=cost.add(markup),tax=selling.mul(l.taxRate).div(100);return {...l,adjustedMarkupAmount:markup.toString(),adjustedMarkupPercent:cost.gt(0)?markup.div(cost).mul(100).toString():null,sellingExcludingTax:money(selling),tax:money(tax),sellingIncludingTax:money(selling.add(tax))};});
 const rounded=adjusted.reduce((n,l)=>n.add(l.sellingExcludingTax).add(l.tax),D('0'));
 return {status:'Reconciled',lines:adjusted,factor:factor.toString(),roundingAdjustment:money(available.sub(rounded)),unresolvedIncludingTax:'0.00',reason:null};
}
export function panelActual(selling:string,referenceBudget:string,actualCost:string|null,scopeUnchanged=true){
 if(actualCost===null)return {profit:null,markup:null,saving:null,scopeUnchanged};
 const actual=D(actualCost);if(actual.lt(0))throw new Error('Actual cost cannot be negative.');
 return {profit:money(D(selling).sub(actual)),markup:actual.gt(0)?D(selling).sub(actual).div(actual).mul(100).toString():null,saving:scopeUnchanged?money(D(referenceBudget).sub(actual)):null,scopeUnchanged};
}
function components(row:UblScopeRow,c:UblConfiguration):{key:string;quantity:string}[]{
 const keys:Record<string,string>={D11R:'6mm² DC Cable Red',D11B:'6mm² DC Cable Black',H29:'UBL Internet',B2:'Structure - Elevated',D5:'DC Breaker',D6:'DC Fuse with Holder',D7:'DC SPD',D8:'DC Breaker',E15:'100A 4P MCCB',E16:c.inverterKw==='20'?'63A 4P MCB':'100A 4P MCCB',E17:'AC SPD',E18:'100A Rotary Changeover with Box',E19:'16mm² 4C AC Cable',E20:c.inverterKw==='20'?'16mm² 4C AC Cable':'25mm² 4C AC Cable',F24:'Earthing Bore',F25:'2.5mm² Earthing Cable',F26:'6mm² Earthing Cable',F27:'10mm² Earthing Cable',G27:'Extra Smart Meter',H28:'Genset Synchronisation with Battery SOC',I29:'Labour'};
 if(row.id==='C3')return [{key:`HYB-3P-${c.inverterKw.padStart(3,'0')}`,quantity:row.quantity}];
 if(row.id==='C4')return [{key:'BAT-HV-05 KW WO BMS',quantity:D(c.essKwh).div(5).toString()},{key:'CH-BMS-HV',quantity:D(c.essKwh).div(20).ceil().toString()}];
 if(keys[row.id])return [{key:keys[row.id],quantity:row.quantity}];
 // A combined cable allowance and separate bundled constituents need verified buying-rate mappings.
 // Do not substitute source selling rates, divide an unspecified cable split, or duplicate a bundle charge.
 return [{key:`UBL scope ${row.id}`,quantity:row.quantity}];
}
export function ublBudget(c:UblConfiguration,m:Masters,policy:CommercialPolicy){
 const agreed=c.history.at(-1)!,panelSelling=D(agreed.panelSellingExcludingGst),panelBudget=panelSelling.div('1.10');
 const panelRate=m.rates.find(r=>r.key==='Solar PV Modules'&&r.status!=='Inactive'&&r.rate!==null);
 const purchase=panelRate&&/^(w|watt|wp)$/i.test(panelRate.unit)?D(panelRate.rate!).mul(c.pvWatts):null;
 const issues:{id:string;reason:string}[]=[],rows:any[]=[],costLines:CostLine[]=[];
 const aliases:Record<string,PolicyCategory>={};
 for(const row of c.currentBoq){
  if(row.id==='A1')continue;
  if(row.deferred){issues.push({id:row.id,reason:'Internet retained in original scope; costing and commercial allocation deferred. No current allowance is assumed.'});rows.push({...row,cost:null,components:[],status:'Deferred'});continue;}
  const parts=components(row,c),priced=parts.map(p=>{const rate=m.rates.find(r=>r.key===p.key&&r.status!=='Inactive'&&r.rate!==null);return {...p,rate:rate?.rate??null,rateVersion:rate?.version??null,rateStatus:rate?.status??null,rateUnit:rate?.unit??null,cost:rate?D(p.quantity).mul(rate.rate!).toString():null};});
  const resolved=priced.every(p=>p.cost!==null),category:PolicyCategory=row.id==='C3'||row.id==='C4'?'bess':row.id==='B2'?'structure':row.id==='F24'?'earthing':'other';
  if(!resolved)issues.push({id:row.id,reason:`Missing verified cost mapping/rate: ${priced.filter(p=>p.cost===null).map(p=>p.key).join(', ')}. Proposal rates are selling rates, not purchase costs.`});
  const cost=resolved?priced.reduce((n,p)=>n.add(p.cost!),D('0')):null;
  rows.push({...row,category,cost:cost?.toString()??null,components:priced,status:resolved?'Budgeted':'Unresolved'});
  if(cost){aliases[row.id]=category;costLines.push({key:row.id,description:row.description,brand:row.brands,brandAlternatives:[],specification:row.specification,specVersion:null,qty:row.quantity,unit:row.unit,rate:cost.div(row.quantity).toString(),rateVersion:0,rateStatus:'UBL frozen reference',total:cost.toString(),phase:category==='bess'?'BESS':'EPC',epc:category==='earthing'?'Earthing Cost':''});}
 }
 const knownCost=costLines.reduce((n,l)=>n.add(l.total),D('0'));
 const boq={lines:costLines,total:knownCost.toString(),survey:{}} as BoqSnapshot;
 const standard=standardItemPrices(boq,{additionalCategory:undefined} as any,{...policy,itemCategories:{...policy.itemCategories,...aliases}});
 for(const row of rows){const price=standard.find(p=>p.key===row.id);if(price){row.standardMarkupPercent=price.markup;row.standardMarkupAmount=D(price.beforeTax).sub(price.cost).toString();row.standardSellingExcludingTax=price.beforeTax;row.taxRate=price.taxRate;}}
 const remainderGross=D(agreed.totalIncludingGst).sub(panelSelling.mul('1.10'));
 // Allocation remains explicit and unresolved while source costs or deferred scope are unresolved.
 const allocation=issues.length?{status:'Awaiting inputs',lines:[],factor:null,roundingAdjustment:null,unresolvedIncludingTax:money(remainderGross),reason:'Resolve missing rates and deferred commercial scope before allocating the remaining fixed selling value.'}:allocateRemaining(rows.map(r=>({id:r.id,cost:r.cost,standardMarkupAmount:r.standardMarkupAmount,taxRate:r.taxRate})),remainderGross.toString());
 const complete=issues.length===0;
 const remainingProfit=complete&&allocation.status==='Reconciled'?remainderGross.div('1.18').sub(knownCost):null;
 const overallProfit=remainingProfit?panelSelling.sub(panelBudget).add(remainingProfit):null;
 return {remainingBudgetedProfit:remainingProfit?.toString()??null,remainingAdjustedMarkup:remainingProfit&&knownCost.gt(0)?remainingProfit.div(knownCost).mul(100).toString():null,overallBudgetedMarkup:overallProfit?overallProfit.div(panelBudget.add(knownCost)).mul(100).toString():null,configuration:c.id,technicalVersion:c.currentTechnicalVersion,policyVersion:policy.version,costingDate:new Date().toISOString(),panel:{label:'Reference panel budget at 10% markup',sellingExcludingGst:panelSelling.toString(),gst:money(panelSelling.mul('0.10')),sellingIncludingGst:money(panelSelling.mul('1.10')),referenceBudget:panelBudget.toString(),budgetedProfit:panelSelling.sub(panelBudget).toString(),budgetedMarkup:'10',currentPurchaseEstimate:purchase?.toString()??null,currentRateSource:panelRate??null,actual:panelActual(panelSelling.toString(),panelBudget.toString(),null)},rows,issues,remainingKnownBudget:knownCost.toString(),combinedKnownBudget:panelBudget.add(knownCost).toString(),combinedTemplateBudget:complete?panelBudget.add(knownCost).toString():null,fixedAgreedTotal:agreed.totalIncludingGst,allocation,overallBudgetedProfit:complete&&allocation.status==='Reconciled'?panelSelling.add(remainderGross.div('1.18')).sub(panelBudget).sub(knownCost).toString():null};
}
