import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historicalInvoiceTerms, issuedInvoiceTerms, invoiceMilestones } from '../server/accounts/invoice-milestones.js';

const ref=(n:number)=>({id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0')});
const signedDo=ref(1), acknowledgment=ref(2), variableSignoff=ref(3), picture=ref(4);
const files = new Map([[signedDo.id,'application/pdf'],[acknowledgment.id,'image/jpeg'],[variableSignoff.id,'image/png'],[picture.id,'image/jpeg']]);
const site = {
  customer:'UBL',projectType:'solar',installation:true,
  deliveries:[{signedDo,deliveryDate:'2026-11-06'}],
  qc:{signoff:{date:'2026-11-08',acknowledgement:acknowledgment,variableSignoff,evidence:picture}},
};

test('historical invoice terms are scoped by exact programme identity and explicit terms win',()=>{
 assert.equal(historicalInvoiceTerms({key:'UBL:UPS:9/250',program:'UPS 250'}),'advance-received-balance-at-completion');
 assert.equal(historicalInvoiceTerms({key:'UBL:UPS:9/250',program:'Solar 70'}),undefined);
 assert.equal(historicalInvoiceTerms({key:'UBL:SOLAR:347',program:'Solar 70'}),'partial-delivery-and-completion');
 for(const size of [20,60,80])assert.equal(historicalInvoiceTerms({key:'MBL:CHP-163:8/20',program:'MBL UPS '+size}),'completion');
 assert.equal(historicalInvoiceTerms({key:'MBL:CHP-999:8/20',program:'Other'}),undefined);
 assert.equal(issuedInvoiceTerms({input:{invoiceTerms:'delivery'},approvedCommercialSource:{key:'UBL-UPS-6-10'}}),'delivery');
 assert.equal(issuedInvoiceTerms({customer:{shortCode:'UBL'},approvedCommercialSource:{type:'framework',key:'35-30-40:Revised'}}),'partial-delivery-and-completion');
 assert.equal(issuedInvoiceTerms({customer:{shortCode:'ELEN'},solutionId:'DIRECT-PRODUCT'}),'delivery');
});

test('signed delivery and complete installation evidence independently open the proper invoice milestone',()=>{
 const full={...site,stage:'completed',completed:true};
 assert.deepEqual(invoiceMilestones('site',full,'delivery',files),{delivery:true,completion:false,partial:null});
 assert.deepEqual(invoiceMilestones('site',full,'completion',files),{delivery:false,completion:true,partial:null});
 assert.deepEqual(invoiceMilestones('site',full,'advance-received-balance-at-completion',files),{delivery:false,completion:true,partial:null});
 assert.deepEqual(invoiceMilestones('site',{...site,stage:'awaiting',partial:true},'partial-delivery-and-completion',files),{delivery:true,completion:false,partial:'2026-11-06'});
 assert.equal(invoiceMilestones('site',{...site,stage:'awaiting',partial:true},'delivery-and-completion',files).delivery,false);
 const missingPhoto=new Map(files);missingPhoto.delete(picture.id);
 assert.equal(invoiceMilestones('site',full,'completion',missingPhoto).completion,false);
 const missingDo=new Map(files);missingDo.delete(signedDo.id);
 assert.equal(invoiceMilestones('site',full,'delivery',missingDo).delivery,false);
 const missingVso=new Map(files);missingVso.delete(variableSignoff.id);
 assert.equal(invoiceMilestones('site',full,'completion',missingVso).completion,false);
 assert.equal(invoiceMilestones('site',{...full,qc:{signoff:{...site.qc.signoff,noVariableItemsUsed:true,variableSignoff:undefined}}},'completion',missingVso).completion,true);
});
