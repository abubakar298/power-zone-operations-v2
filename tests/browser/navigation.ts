import type {Page} from '@playwright/test';
/** Follow the current role-specific sidebar; business assertions stay unchanged. */
export async function openWorkspaceSection(page:Page,label:string) {
 await page.locator('.account-trigger').last().waitFor({state:'visible'});
 const direct=page.getByRole('button',{name:label,exact:true});
 if(await direct.isVisible().catch(()=>false)){await direct.click();return;}
 // Management uses a compact landing page. Existing workspaces retain stable
 // deep links; this keeps the same permission and business assertions in use.
 const routes:Record<string,string>={'Dashboard':'dashboard','Master data':'masters','Survey & BOQ':'boqs','Commercial pricing':'pricing','Quotations':'quotes','Customer PO & IPO':'orders','BOQ to Operations':'operations','Inventory workspace':'inventory','Accounts workspace':'finance','Team access':'team','My account':'account','UBL Site Workflow':'ubl-workflow','Customer & site budgets':'reports','Approvals':'dashboard','Rate Master':'rates'};
 if(!routes[label])throw Error(`No current workspace route for ${label}`);
 await page.goto(`/dashboard#workspace=${routes[label]}`);
 await page.reload();
 await page.locator('main').waitFor();
}

export async function signOut(page:Page) {
 const button=page.getByRole('button',{name:'Sign out',exact:true});
 if(!(await button.isVisible()))await page.locator('.account-trigger').last().click();
 await button.click();
 await page.getByRole('heading',{name:'Welcome back.',exact:true}).waitFor();
}

/** Open the real accordion through its summary before entering measured inputs. */
export async function openBoqSection(page:Page,section:2|3){
 const summary=page.locator('summary').filter({hasText:section===2?'2 · Survey Quantities & Solution':'3 · Brands & Preparation'});
 if(await summary.count()&&!(await summary.locator('..').getAttribute('open')!==null))await summary.click();
}

export async function chooseBrand(page:Page,field:string,label:string){
 await openBoqSection(page,3);
 const category=field.replace(/ brand$/,'').replace('Solar Panel','Solar Panel');
 const picker=page.getByRole('combobox',{name:`${category} brands`,exact:true});
 if(label==='Any of the Above'){
   await picker.click();
   const count=await page.getByRole('listbox',{name:`${category} choices`,exact:true}).getByRole('option').count();
   for(let i=0;i<count;i++){await picker.click();await page.getByRole('listbox',{name:`${category} choices`,exact:true}).getByRole('option').first().click();}
 }else{await picker.fill(label);await page.getByRole('option',{name:label,exact:true}).click();}
}

export async function beginBoq(page:Page,quick=false){
 const button=page.getByRole('button',{name:quick?'Quick BOQ · no survey':'New BOQ',exact:true});
 await button.or(page.getByLabel('Document action',{exact:true})).first().waitFor({state:'visible'});
 if(await button.isVisible())await button.click();
 else await page.getByLabel('Document action',{exact:true}).selectOption(quick?'general':'new');
}
