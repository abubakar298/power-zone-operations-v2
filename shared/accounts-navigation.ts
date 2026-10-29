/** Preserve old links while keeping Accounts on the consolidated entry points. */
export function accountsPageName(page:string|undefined|null){
 if(page==='Programme Dashboard'||page==='Project Sites')return 'Project Tracking';
 if(page==='Invoicing')return 'Invoices to Submit';
 if(page==='Receivables')return 'My Workspace';
 return page||'My Workspace';
}
