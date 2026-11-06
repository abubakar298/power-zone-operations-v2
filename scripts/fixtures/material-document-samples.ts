import {randomUUID} from 'node:crypto';
import {parentDraftPrintModel,simulatedMaterialPrintModel,sitePlanPrintModel} from '../../server/inventory/material-document-model.js';

/** Fictional QA records only; never imported into a business database. */
export function materialDocumentSamples(){
 const siteA=randomUUID(),siteB=randomUUID(),cable=randomUUID(),lugs=randomUUID();
 const dispatch={id:randomUUID(),reference:'SAMPLE-PDO-001',warehouse:'Lahore warehouse',kind:'variable',parent:true,sites:[{id:siteA,ipo:'SAMPLE-IPO-A',installation:true,basisId:randomUUID(),basisVersion:1},{id:siteB,ipo:'SAMPLE-IPO-B',installation:true,basisId:randomUUID(),basisVersion:1}],lines:[{key:cable,itemId:'CH-CBL-AC-16MM/4C-PK',description:'16mm2 AC cable, 4 core',unit:'m',out:'70',sites:[siteA,siteB]},{key:lugs,itemId:'CH-Mix Items All',description:'16mm lugs',unit:'piece',out:'35',sites:[siteA,siteB]}],usage:[{siteId:siteA,lineKey:cable,used:'20'},{siteId:siteB,lineKey:cable,used:'10'},{siteId:siteA,lineKey:lugs,used:'20',issued:'23',returned:'3'},{siteId:siteB,lineKey:lugs,used:'12',issued:'12',returned:'0'}],extraSources:[],receipts:[]};
 const source={siteId:siteA,siteName:'Training Site A - fictional sample',ipo:'SAMPLE-IPO-A',orderNumber:'1/6',installation:true,customer:'Sample customer',customerPo:'SAMPLE-CUSTOMER-PO-A'};
 const fixed={id:randomUUID(),version:1,snapshot:{kind:'fixed' as const,parent:false,warehouse:'Lahore warehouse',sites:[source],lines:[{key:randomUUID(),itemId:'CH-PCS-HYB-3P-015',description:'15kW hybrid inverter',unit:'piece',out:'2',sites:[siteA]},{key:randomUUID(),itemId:'CH-BAT-HV-05 KW',description:'5kWh HV battery',unit:'piece',out:'8',sites:[siteA]},{key:randomUUID(),itemId:'CH-Earthing',description:'Earthing Bore',unit:'No.',out:'2',sites:[siteA]}]}};
 const variable={id:randomUUID(),version:1,snapshot:{...fixed.snapshot,kind:'variable' as const,lines:dispatch.lines}};
 const plan={id:randomUUID(),version:1,variableSupply:'single-site',fixed,variable};
 const parent={...variable,snapshot:{...variable.snapshot,parent:true,sites:[source,{...source,siteId:siteB,siteName:'Training Site B - fictional sample',ipo:'SAMPLE-IPO-B',orderNumber:'2/6'}]}};
 const customer=simulatedMaterialPrintModel(dispatch,'customer-signoff',siteA),internal=simulatedMaterialPrintModel(dispatch,'irr',siteA);
 customer.sites=[{name:source.siteName,ipo:source.ipo,orderNumber:source.orderNumber,customer:source.customer,customerPo:source.customerPo}];internal.sites=customer.sites;
 return {dispatch,plan,parent,siteA,siteB,models:{'material-fixed-do-preview':sitePlanPrintModel(plan,'fixed-do'),'parent-variable-dispatch-preview':parentDraftPrintModel(parent),'parent-site-customer-signoff-simulation':customer,'parent-site-internal-irr-simulation':internal}};
}
