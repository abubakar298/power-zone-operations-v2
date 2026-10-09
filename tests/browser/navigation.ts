import type {Page} from '@playwright/test';
/** Follow the current role-specific sidebar; business assertions stay unchanged. */
export async function openWorkspaceSection(page:Page,label:string) {
 const navigation=page.getByRole('navigation',{name:'Main navigation',exact:true});
 await navigation.waitFor();
 if(await navigation.getByRole('button',{name:'My Workspace',exact:true}).count()) {
  const primary:Record<string,string>={'Dashboard':'My Workspace','Master data':'Customers & Sites'};
  if(primary[label])return navigation.getByRole('button',{name:primary[label],exact:true}).click();
  const project:Record<string,string>={'Survey & BOQ':'Surveys & BOQs','Customer PO & IPO':'IPOs','BOQ to Operations':'BOQs to Operations','Quotations':'Quotations'};
  if(project[label]) {await navigation.getByRole('button',{name:'Projects',exact:true}).click();return page.getByRole('button',{name:project[label],exact:true}).click();}
 }
 await page.getByRole('button',{name:label,exact:true}).click();
}
