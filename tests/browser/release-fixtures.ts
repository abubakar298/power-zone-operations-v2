import {expect,type Page,type APIRequestContext} from '@playwright/test';
export const origin=`http://127.0.0.1:${process.env.PZ_E2E_PORT??'3180'}`;
export const password='browser-test-passphrase-298';
export async function login(request:APIRequestContext,email='admin@example.test'){
 const current=await request.get('/api/auth/session');if(current.ok()){const session=await current.json();if(session.user.email===email)return {Origin:origin,'X-CSRF-Token':session.csrfToken};}
 const response=await request.post('/api/auth/login',{headers:{Origin:origin},data:{email,password}});
 expect(response.ok(),await response.text()).toBe(true);
 const session=await response.json();return {Origin:origin,'X-CSRF-Token':session.csrfToken};
}
let actorsReady=false;let actorHeaders:Record<string,string>;
export async function actors(request:APIRequestContext){
 if(actorsReady)return actorHeaders;
 const status=await(await request.get('/api/auth/status')).json();
 if(status.setupRequired)expect((await request.post('/api/auth/setup',{headers:{Origin:origin},data:{email:'admin@example.test',displayName:'Abu Bakar Siddique',password,setupToken:'browser-test-setup-key-isolated-only'}})).status()).toBe(201);
 const headers=await login(request);
 const existing=await(await request.get('/api/accounts')).json();
 for(const role of ['Coordinator','Management','Design','Inventory','Accounts']){
  const email=role.toLowerCase()+'-release@example.test';
  const rows=Array.isArray(existing)?existing:existing.accounts??existing.users??[];
  if(rows.some((u:any)=>u.email===email))continue;
  const r=await request.post('/api/accounts/create',{headers,data:{email,displayName:'Release '+role,role,password,newPassword:password,confirmPassword:password}});
  expect([201,409]).toContain(r.status());
 }
 actorsReady=true;actorHeaders=headers;return headers;
}
export async function survey(request:APIRequestContext,code:string){
 const masters=await(await request.get('/api/masters')).json();
 const brand=(category:string)=>masters.brands.find((b:any)=>b.category===category&&b.status==='Active'&&b.name!=='Any of the Above').id;
 return {customerId:3,siteName:'Release validation '+code,siteCode:code,location:'Lahore',panelQty:20,panelWattage:'645',structure:'Elevated',dcMetres:'100',acInverter16:'10',acPanel16:'20',earth25:'20',earth6:'30',earth10:'30',inverter:'12 kW',batteryKwh:20,smartMeter:false,genset:false,preparedBy:'Release validation',brands:{solar:brand('Solar Panel'),inverter:brand('Inverter'),battery:brand('Battery & BMS'),cable:brand('Cable'),switchgear:brand('Switchgear')}};
}
export async function seedQuote(request:APIRequestContext,headers:Record<string,string>,code:string,submitted=false,discount='0'){
 const inputs=await survey(request,code);
 const post=async(path:string,data:any)=>{const r=await request.post('/api'+path,{headers,data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
 const draft=await post('/boqs/drafts',{version:0,inputs});
 const bp=await post('/boqs/preview',inputs);
 const boq=await post('/boqs/save',{draftId:draft.id,version:draft.version,fingerprint:bp.fingerprint});
 const input={boqRevisionId:boq.id,presentation:'Full Breakup',taxMode:'Tax Included',discountMode:'Custom',discountPercent:'0',preparedBy:'Release validation'};
 const pp=await post('/commercial/pricing/preview',input);
 const pricing=await post('/commercial/pricing',{...input,fingerprint:pp.fingerprint,requestKey:crypto.randomUUID()});
 const qi={pricingId:pricing.id,quotedDate:'2026-10-23',validity:'7 Days',proposedBy:'Release validation',discount};
 const qp=await post('/commercial/quotations/preview',qi);
 const quote=await post('/commercial/quotations',{...qi,fingerprint:qp.fingerprint,requestKey:crypto.randomUUID()});
 if(submitted)await post('/coordinator/events',{quotationId:quote.id,kind:'Submitted'});
 return {quote,pricing,boq,inputs};
}
export async function openSavedQuote(page:Page,number:string){
 await page.goto('/dashboard#workspace=quotes');
 const session=await(await page.request.get('/api/auth/session')).json();
 if(session.user.role==='Coordinator'){
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search projects and documents'}).fill(number);
  await page.getByRole('button',{name:'Open project',exact:true}).click();
  await page.getByRole('button',{name:'Documents',exact:true}).click();
  await page.getByRole('row').filter({hasText:number}).getByRole('button',{name:'Revise Quotation',exact:true}).click();
 }else await page.getByRole('button',{name:new RegExp(number.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
 await expect(page.locator('.quotation-pdf-pages canvas').first()).toBeVisible();
}

/** Run the normal notification projection against the owned disposable database.
 * Browser checks need not wait for the production 30-second timer. No email delivery. */
export async function syncFixtureNotifications(){
 const {readFile}=await import('node:fs/promises');const {default:pg}=await import('pg');
 const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT??'3180'}.json`,'utf8'));
 const db=new URL(fixture.databaseUrl);
 if(fixture.marker!=='power-zone-disposable-browser-fixture-v1'||db.hostname!=='127.0.0.1'||db.pathname!=='/power_zone_test'||db.username!=='postgres')throw Error('Owned disposable notification fixture required.');
 const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:1});
 try{const actual=(await pool.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")).rows[0];if(actual.name!=='power_zone_test'||!/[\\/]pz-v2-test-[^\\/]+[\\/]db$/.test(actual.directory))throw Error('Owned disposable database directory required.');const {NotificationsRepository}=await import('../../server/notifications/repository.js');await new NotificationsRepository(pool).sync();}finally{await pool.end();}
}
