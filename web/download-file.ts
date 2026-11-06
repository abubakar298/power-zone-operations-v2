import {departmentFetch} from './department-view.js';

/** Keep the current department's authorization context on private downloads. */
export async function downloadDepartmentFile(path:string,filename:string){
 const response=await departmentFetch(path,{cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Sign in again to download this file.':'This file could not be opened. Refresh and try again.');
 const url=URL.createObjectURL(await response.blob());
 const link=document.createElement('a');link.href=url;link.download=filename;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
