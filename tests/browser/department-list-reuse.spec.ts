import {test,expect} from '@playwright/test';
import {actors,login} from './release-fixtures.js';

// Fix 5 (16 Nov 2026): opening the Coordination page asks for the project list and the customer/site
// lists once each, and reopening it within 5 minutes reuses the customer/site lists.
test('the coordination page loads its project list and reference lists once, and reuses references for 5 minutes',async({page})=>{
 await actors(page.request);await login(page.request,'coordinator-release@example.test');
 const start=Date.now();await page.clock.install({time:start});
 const counts={list:0,references:0};
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/project-workflow'&&url.searchParams.get('department')==='coordination'&&url.searchParams.get('scope')==='mine')counts.list++;if(url.pathname==='/api/project-workflow/references')counts.references++;});
 await page.goto('/dashboard');
 await expect(page.locator('.sidebar-bucket-count').first()).not.toHaveText('…');
 await page.waitForLoadState('networkidle');
 expect(counts,'first opening').toEqual({list:1,references:1});
 // Reopening the workspace refreshes the project list but reuses the customer and site lists.
 await page.evaluate(()=>window.dispatchEvent(new Event('pz:workspace-open')));
 await expect.poll(()=>counts.list).toBe(2);await page.waitForLoadState('networkidle');
 expect(counts.references,'reopened within 5 minutes').toBe(1);
 // After 5 minutes the customer and site lists are downloaded again.
 await page.clock.setSystemTime(start+5*60_000+1_000);
 await page.evaluate(()=>window.dispatchEvent(new Event('pz:workspace-open')));
 await expect.poll(()=>counts.references).toBe(2);
});
