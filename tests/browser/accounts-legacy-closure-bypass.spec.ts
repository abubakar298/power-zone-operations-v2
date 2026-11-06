import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';
// Temporary old-record bypass: Accounts sends an old Draft to Management without evidence, with a reason.
test('Accounts sends an old Draft closure to Management without evidence and Management sees the label',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const names=['Solar Panels','Structure','Inverter','Batteries','BMS','EPC'];
 const snapshot:any={jobKey:'ubl:1',jobId:'SIM-CLOSURE',title:'Submitted closure fixture',identity:{job_id:'SIM-CLOSURE',customer_code:'UBL',site_name:'Submitted closure fixture'},entry:{start:'2026-10-01',end:'2026-10-02'},selling:'1200000.00',phaseSelling:Object.fromEntries(names.map(p=>[p,'200000.00'])),budget:Object.fromEntries(names.map(p=>[p,'100000.00'])),epcBudget:{'Electrical Labour':'25','Earthing Cost':'25',Deliveries:'25','Installation Cost':'25'},input:{actual:Object.fromEntries(names.slice(0,5).map(p=>[p,'80000.00'])),epc:{},epcAggregate:'80000.00',epcDetails:false,remarks:'Submitted PT costs',acknowledgment:'',photos:'',ptReference:'PT-1',ptAttachmentId:null},actualEpc:'80000.00',summary:{selling:'1200000.00',actual:'480000.00'},basis:'Saved submitted fixture',reconciliation:{},evidence:[]};
 let closure:any={id:'closure-draft',job_key:'ubl:1',stage:'Draft',version:1,created_at:'2026-10-25T09:00:00Z',snapshot:{...snapshot,input:{...snapshot.input,remarks:'Costs checked against PT'}},recorded_by:'Accounts'};
 const history=[closure];let posted:any;
 await page.route('**/api/accounts-workspace',r=>r.fulfill({json:{ipos:[],closures:[closure]}}));
 await page.route('**/api/inventory-reconciliation/reports',r=>r.fulfill({json:{reports:[{id:'report-1',report_id:'report-1',job_key:'ubl:1',job_id:'SIM-CLOSURE',site_name:'Submitted closure fixture',title:'Submitted closure fixture',stage:'Sent to Accounts',version:2,created_at:'2026-10-20T09:00:00Z'}]}}));
 await page.route('**/api/accounts-workspace/job?*',r=>r.fulfill({json:{...closure.snapshot,history,legacyEvidenceBypassEligible:closure.stage==='Draft'}}));
 await page.route('**/api/accounts-workspace/closures',async r=>{posted=r.request().postDataJSON();closure={...closure,id:'closure-sent',version:2,stage:'Awaiting Management',snapshot:{...closure.snapshot,input:posted,legacyEvidenceBypass:{reason:posted.legacyEvidenceBypass?.reason,label:'Sent without evidence – old record'}}};history.unshift(closure);await r.fulfill({json:closure});});
 await page.goto('/dashboard#workspace=finance&accountsTab=Job+Closure');
 await page.getByRole('button',{name:'Open job',exact:true}).first().click();
 await page.getByRole('button',{name:'Send without evidence (old record)',exact:true}).click();
 const send=page.getByRole('button',{name:'Send without evidence',exact:true});
 await expect(send).toBeDisabled();
 await page.getByLabel('Reason (required)',{exact:true}).fill('Historical record, originals not available');
 await expect(send).toBeEnabled();await send.click();
 await page.getByRole('dialog',{name:'Send without evidence (old record)'}).getByRole('button',{name:'Send without evidence',exact:true}).click();
 await expect(page.getByText('Old record sent to Management without evidence. The reason is recorded.',{exact:true})).toBeVisible();
 expect(posted.stage).toBe('Awaiting Management');expect(posted.version).toBe(1);expect(posted.legacyEvidenceBypass).toEqual({reason:'Historical record, originals not available'});
 await expect(page.getByText('Sent without evidence – old record',{exact:false}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Send without evidence (old record)',exact:true})).toHaveCount(0);
});
