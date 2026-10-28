/** Explicit internal destinations only. A notification never grants record access. */
export function notificationPath(target:unknown):string|null {
 if(!target||typeof target!=='object')return null;
 const path=(target as {path?:unknown}).path;
 if(typeof path!=='string'||path.includes('\\')||/[\u0000-\u0020\u007f?#]/.test(path))return null;
 if(/^\/accounts\/(ipos|inventory|documents|closures|closure-review|invoicing)$/.test(path)||path==='/inventory/parent-dos')return path;
 const match=/^\/operations\/sites\/([^/]+)$/.exec(path);
 if(!match)return null;
 try {const id=decodeURIComponent(match[1]);if(!id.trim()||id==='.'||id==='..'||/[\/\\\u0000-\u001f\u007f]/.test(id))return null;return '/operations/sites/'+encodeURIComponent(id);}catch{return null;}
}
export function notificationDocumentUrl(target:unknown):string|null {
 if(!target||typeof target!=='object')return null;
 const url=(target as {url?:unknown}).url;
 return typeof url==='string'&&/^\/api\/(project-workflow|orders)\/[A-Za-z0-9/-]+$/.test(url)?url:null;
}
