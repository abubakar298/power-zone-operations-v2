import {test,expect} from '@playwright/test';
import {Decimal} from 'decimal.js';
import {actors,login} from './release-fixtures.js';
test('UBL configuration history preserves original scopes and prices and tolerates restricted portfolio costs',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await actors(page.request);await login(page.request);const list=await(await page.request.get('/api/ubl')).json();expect(list.configurations).toHaveLength(4);
 const details=await Promise.all(list.configurations.map(async(c:any)=>(await page.request.get('/api/ubl/'+c.id)).json()));
 const evidence=details.map(d=>JSON.stringify({technical:d.technical,history:d.history}));
 await page.goto('/dashboard#workspace=ubl');await expect(page.getByRole('heading',{name:'UBL Solar — Configuration Price History',exact:true})).toBeVisible();
 const table=page.locator('.ubl-history-table');
 await expect(table.locator('tbody tr')).toHaveCount(details.reduce((n,d)=>n+d.history.length,0));
 for(const detail of details){
  await expect(table.getByRole('rowheader',{name:detail.configuration.id,exact:true}).first()).toBeVisible();
  for(const h of detail.history){const s=h.snapshot;const panel=new Decimal(s.panelSellingExcludingGst);const selling=panel.add(new Decimal(s.totalIncludingGst).sub(panel.mul('1.10')).div('1.18'));const shown=selling.toDecimalPlaces(0).toNumber().toLocaleString('en-US');await expect(table.getByRole('cell',{name:shown,exact:true}).first()).toBeVisible();}
 }
 await expect(page.getByRole('heading',{name:'Portfolio Performance',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'This workspace could not be opened'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:900});await page.reload();await expect(table.locator('tbody tr')).toHaveCount(details.reduce((n,d)=>n+d.history.length,0));
 for(let i=0;i<details.length;i++){const d=await(await page.request.get('/api/ubl/'+details[i].configuration.id)).json();expect(JSON.stringify({technical:d.technical,history:d.history})).toBe(evidence[i]);}
 expect(errors).toEqual([]);
});
