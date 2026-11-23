/** format 'numbered' = quotation/IPO file named after its own number (see numberedDownloadName); customerName is
 * the full customer name used there (customer may be a short code). */
export interface DownloadName {customer?:string;customerName?:string;site?:string;siteCode?:string;documentType:string;identity:string;reference?:string;revision?:number;extension:string;format?:'numbered'}
export function filenamePart(value:string|undefined,fallback:string,limit:number){
 const clean=(value??'').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
 return (clean||fallback).slice(0,limit).trim().replace(/[. ]+$/g,'');
}
/** Stable browser fallback for offline draft previews. Server exports use a unique registered alias. */
export function fallbackDownloadReference(identity:string){let hash=14695981039346656037n;for(const c of identity){hash^=BigInt(c.codePointAt(0)!);hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(36).toUpperCase();}
/** The saved number without the " (SHORT-SITE)" tail that older CPZ numbers carry. Typed numbers stay as saved. */
export function cleanDocumentNumber(number:string){return number.startsWith('CPZ-')?number.replace(/\s*\([^()]*\)\s*$/,''):number;}
/** Quotation and IPO files (Atif's naming, user request 23 Nov 2026): "<number> - <customer> - <site name> - <site code>",
 * e.g. "QT-70-R1 - Vigilant Pharma - Johar Town - JOHART.pdf". The number already carries -R1, -R2 for revisions.
 * Site name and site code are left out when not recorded (never invented); a code equal to the name is not repeated. */
export function numberedDownloadName(input:{number:string;customer?:string;site?:string;siteCode?:string;extension:string}){
 const parts=[filenamePart(cleanDocumentNumber(input.number),'Document',60),filenamePart(input.customer,'Customer not recorded',80)];
 const site=filenamePart(input.site,'',80),code=filenamePart(input.siteCode,'',30);
 if(site)parts.push(site);
 if(code&&code.toLowerCase()!==site.toLowerCase())parts.push(code);
 return `${parts.join(' - ')}.${input.extension.replace(/[^a-z0-9]/gi,'').toLowerCase()||'pdf'}`;
}
export function downloadName(input:DownloadName){
 if(input.format==='numbered'&&input.reference?.trim())return numberedDownloadName({number:input.reference,customer:input.customerName??input.customer,site:input.site,siteCode:input.siteCode,extension:input.extension});
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
