import {departmentFetch} from './department-view.js';
import {filenameFromDisposition} from '../shared/download-name.js';

/** Keep the current department's authorization context on private downloads. The server's file name (the app's
 * one naming structure) wins; `filename` is only the fallback when the response names none. */
export async function downloadDepartmentFile(path:string,filename:string){
 const response=await departmentFetch(path,{cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Sign in again to download this file.':'This file could not be opened. Refresh and try again.');
 const url=URL.createObjectURL(await response.blob());
 const link=document.createElement('a');link.href=url;link.download=filenameFromDisposition(response.headers.get('Content-Disposition'))??filename;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
