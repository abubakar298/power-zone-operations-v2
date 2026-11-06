/** Keep Inventory navigation inside the authenticated application. */
export function navigateInventory(path:string){
 if(!path.startsWith('/inventory')){location.assign(path);return;}
 history.pushState(null,'',path);window.dispatchEvent(new Event('inventory:navigate'));window.scrollTo(0,0);
}
