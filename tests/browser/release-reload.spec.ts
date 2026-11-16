import {test,expect,type Page} from '@playwright/test';
import {actors,login} from './release-fixtures.js';

// After a release the previous build's screen files are gone (the server answers 404). A tab opened
// before the release must reload itself once, never loop, and never throw away unsaved typing.
const screenFile='**/assets/ManagementDashboard-*.js';
async function countLoads(page:Page){const loads={count:0};page.on('load',()=>{loads.count++;});return loads;}

test('a screen file missing after a release reloads the page once and the screen then opens',async({page})=>{
 await actors(page.request);await login(page.request,'management-release@example.test');
 let blocked=0;
 await page.route(screenFile,async route=>{if(blocked++===0)return route.fulfill({status:404,contentType:'text/plain',body:'Not found'});return route.continue();});
 const loads=await countLoads(page);
 await page.goto('/dashboard');
 await expect.poll(()=>loads.count).toBe(2);
 await expect(page.getByRole('main',{name:'Management landing page'})).toBeVisible();
 await expect(page.getByText('This workspace could not be opened')).toHaveCount(0);
});

test('the page never reloads by itself in a loop',async({page})=>{
 await actors(page.request);await login(page.request,'management-release@example.test');
 await page.route(screenFile,route=>route.fulfill({status:404,contentType:'text/plain',body:'Not found'}));
 const loads=await countLoads(page);
 await page.goto('/dashboard');
 await expect(page.getByText('This workspace could not be opened')).toBeVisible();
 await page.waitForTimeout(1500);
 expect(loads.count).toBe(2);
});

test('with unsaved typing the page does not reload and asks the user to save first',async({page})=>{
 await actors(page.request);await login(page.request,'management-release@example.test');
 // Stands in for an open editor with unsaved changes (useUnsavedChanges listens to this event).
 await page.addInitScript(()=>window.addEventListener('power-zone:before-workspace-navigation',event=>event.preventDefault()));
 await page.route(screenFile,route=>route.fulfill({status:404,contentType:'text/plain',body:'Not found'}));
 const loads=await countLoads(page);
 await page.goto('/dashboard');
 await expect(page.getByText('A new version of the portal is ready. Save your work, then reload the page.')).toBeVisible();
 await page.waitForTimeout(1500);
 expect(loads.count).toBe(1);
});
