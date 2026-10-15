export interface DownloadName {customer?:string;site?:string;siteCode?:string;documentType:string;identity:string;reference?:string;revision?:number;extension:string}
export function filenamePart(value:string|undefined,fallback:string,limit:number){
 const clean=(value??'').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
 return (clean||fallback).slice(0,limit).trim().replace(/[. ]+$/g,'');
}
/** Stable browser fallback for offline draft previews. Server exports use a unique registered alias. */
export function fallbackDownloadReference(identity:string){let hash=14695981039346656037n;for(const c of identity){hash^=BigInt(c.codePointAt(0)!);hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(36).toUpperCase();}
export function downloadName(input:DownloadName){
 const customer=filenamePart(input.customer,'Customer not recorded',32),siteName=filenamePart(input.site,'Site not recorded',42),code=filenamePart(input.siteCode,'',20);
 const site=code&&!siteName.includes(code)?`${siteName} ${code}`:siteName;
 const reference=filenamePart(input.reference||fallbackDownloadReference(input.identity),'Document',22);
 const revision=input.revision&&Number.isInteger(input.revision)&&input.revision>0?`-R${input.revision}`:'';
 const extension=input.extension.replace(/[^a-z0-9]/gi,'').toLowerCase()||'pdf';
 return `${customer} - ${site} - ${filenamePart(input.documentType,'Document',32)} - ${reference}${revision}.${extension}`;
}
export function filenameFromDisposition(header:string|null){
 if(!header)return undefined;const encoded=header.match(/filename\*=UTF-8''([^;]+)/i);if(encoded){try{return decodeURIComponent(encoded[1].trim())}catch{}}
 return header.match(/filename="([^"]+)"/i)?.[1]??header.match(/filename=([^;]+)/i)?.[1]?.trim();
}
