import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';

test('independent Accounts pages avoid work queues and load queues only when opened',async({page})=>{
 await actors(page.request);await login(page.request,'accounts-release@example.test');
 const counts={workspace:0,reports:0};
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/api/accounts-workspace')counts.workspace++;if(path==='/api/inventory-reconciliation/reports')counts.reports++;});
 for(const tab of ['Programme Dashboard','Project Sites','Physical Documents','Approved Documents','Invoicing']){
  const path='/dashboard#workspace=finance&accountsTab='+encodeURIComponent(tab);
  await page.goto('about:blank');await page.goto(path);await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading',{name:'Accounts workspace',exact:true})).toBeVisible();
  expect(counts,`unrelated queue requests on ${path}`).toEqual({workspace:0,reports:0});
 }
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'IPOs Received',exact:true}).click();
 await expect.poll(()=>counts.workspace).toBe(1);await page.waitForLoadState('networkidle');expect(counts.reports).toBe(0);
 await expect(page.getByRole('heading',{name:'IPO Entries',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Inventory & PT',exact:true}).click();
 await expect.poll(()=>counts.reports).toBe(1);await page.waitForLoadState('networkidle');expect(counts.workspace).toBe(2);
 await expect(page.getByRole('heading',{name:'Inventory Reconciliations · PT Entries',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Dashboard',exact:true}).click();
 await expect.poll(()=>counts.reports).toBe(2);await page.waitForLoadState('networkidle');expect(counts.workspace).toBe(3);
 // Receivables is an owner-approved legacy alias for My Workspace, so it intentionally loads the work queues.
 await page.goto('about:blank');await page.goto('/dashboard#workspace=finance&accountsTab=Receivables');await expect.poll(()=>counts.reports).toBe(3);await page.waitForLoadState('networkidle');expect(counts.workspace).toBe(4);
});

test('management refresh skips hidden pages and coalesces focus while requests are pending',async({page})=>{
 await actors(page.request);await login(page.request,'management-release@example.test');
 const paths=['/api/director/received-pos','/api/ubl/sites','/api/project-checkpoints','/api/accounts-workspace/closure-queue','/api/project-workflow/ubl-survey-packages','/api/project-workflow','/api/boqs/reviews'];
 const counts=new Map(paths.map(path=>[path,0]));
 const completed=new Map(paths.map(path=>[path,0]));
 page.on('requestfinished',request=>{const path=new URL(request.url()).pathname;if(completed.has(path))completed.set(path,completed.get(path)!+1);});
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(counts.has(path))counts.set(path,counts.get(path)!+1);});
 await page.goto('/dashboard');await page.waitForLoadState('networkidle');for(const path of paths)expect(counts.get(path),path).toBe(1);
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pz:workspace-open'));});
 await page.waitForLoadState('networkidle');for(const path of paths)expect(counts.get(path),`hidden ${path}`).toBe(1);
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/**',async route=>{if(paths.includes(new URL(route.request().url()).pathname))await held;await route.continue();});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
 await expect.poll(()=>paths.every(path=>counts.get(path)===2)).toBe(true);
 await page.evaluate(()=>{for(let i=0;i<5;i++)window.dispatchEvent(new Event('focus'));});
 for(const path of paths)expect(counts.get(path),`overlapping ${path}`).toBe(2);
 release();await expect.poll(()=>Object.fromEntries(completed)).toEqual(Object.fromEntries(paths.map(path=>[path,2])));
 // A previous networkidle load state can already be satisfied while routed requests are held.
 // Wait for actual response bodies, then let the hooks consume their promises.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>Object.fromEntries(counts)).toEqual(Object.fromEntries(paths.map(path=>[path,3])));
});
