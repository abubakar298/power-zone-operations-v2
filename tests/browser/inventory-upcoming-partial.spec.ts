import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';

test('Upcoming Projects reopens each existing Materials plan while gate copies are pending',async({page})=>{
 await actors(page.request);
 await login(page.request);
 const projects=[
  {ipo:'CHP-353',siteName:'Al Noor',number:'CPZ-DO-26-0021'},
  {ipo:'CHP-354',siteName:'Rehmania Mor',number:'CPZ-DO-26-0022'},
  {ipo:'CHP-355',siteName:'Steel Market',number:'CPZ-DO-26-0023'},
 ].map((site,index)=>({
  ...site,siteId:'site-'+index,registeredSiteId:'registered-'+index,customer:'UBL',dispatchDate:null,
  planId:'00000000-0000-4000-8000-00000000000'+index,
 }));
 const warehouse='Karachi warehouse';
 await page.route('**/api/procurement/store',r=>r.fulfill({json:{toReceive:[]}}));
 await page.route('**/api/inventory-reviews',r=>r.fulfill({json:{rows:[]}}));
 await page.route('**/api/material-dispatches/**',r=>{
  const path=new URL(r.request().url()).pathname.replace('/api/material-dispatches','');
  if(path==='/access')return r.fulfill({json:{kind:'dispatcher'}});
  if(path==='/intake')return r.fulfill({json:{warehouses:[warehouse],catalogue:[],sources:[],
   registeredPending:[{...projects[0],siteId:projects[0].registeredSiteId,registeredSiteId:undefined,planId:undefined,linkStatus:'approved-boq-link-required'}],continuingProjects:projects}});
  if(path==='/document-status')return r.fulfill({json:{rows:[]}});
  if(path==='/stock')return r.fulfill({json:{positions:[]}});
  if(path==='/transport-choices')return r.fulfill({json:{choices:[]}});
  const project=projects.find(s=>path.startsWith('/site-plans/'+s.planId));
  if(project&&path.endsWith('/issued'))return r.fulfill({json:{dispatches:[
   {id:project.siteId,number:project.number,createdAt:'2026-11-02T05:00:00Z',partialDelivery:true,lines:[]},
  ]}});
  if(project)return r.fulfill({json:{id:project.planId,version:1,variableSupply:'single-site',variable:null,fixed:{
   id:'draft-'+project.siteId,version:1,snapshot:{warehouse,sites:[{...project,installation:true,items:[]}],lines:[],
    transport:{issuedTo:'Test team',vehicle:'',driver:'',driverIdentity:''}},
  }}});
  return r.fulfill({json:{}});
 });
 for(const project of projects){
  await page.goto('/inventory');
  await page.getByRole('searchbox',{name:'Search site, IPO or customer'}).fill(project.ipo);
  const row=page.getByRole('row').filter({hasText:project.ipo});
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Partial delivery');
  await row.getByRole('button',{name:'Open materials'}).click();
  await expect(page).toHaveURL(new RegExp('/inventory/materials/'+project.planId+'$'));
  await expect(page.getByRole('region',{name:'DOs for this project'})).toContainText(project.number);
 }
});
