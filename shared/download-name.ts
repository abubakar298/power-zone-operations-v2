/** customer may be a short code; customerName is the full name used in the file name when known.
 * reference is the document's own saved number; alias is the stable registered stand-in for files without one. */
export interface DownloadName {customer?:string;customerName?:string;site?:string;siteCode?:string;documentType:string;identity:string;reference?:string;alias?:string;revision?:number;extension:string}
export function filenamePart(value:string|undefined,fallback:string,limit:number){
 const clean=(value??'').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/g,'');
 return (clean||fallback).slice(0,limit).trim().replace(/[. ]+$/g,'');
}
/** Stable browser fallback for offline draft previews. Server exports use a unique registered alias. */
export function fallbackDownloadReference(identity:string){let hash=14695981039346656037n;for(const c of identity){hash^=BigInt(c.codePointAt(0)!);hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(36).toUpperCase();}
/** The saved number without the " (SHORT-SITE)" tail that older CPZ numbers carry. Typed numbers stay as saved. */
export function cleanDocumentNumber(number:string){return number.startsWith('CPZ-')?number.replace(/\s*\([^()]*\)\s*$/,''):number;}
/** One file name structure for every download (user request 23 Nov 2026, from Atif's quotation/IPO naming):
 * "<number> - <customer> - <site name> - <site code>", e.g. "QT-70-R1 - Vigilant Pharma - Johar Town - JOHART.pdf".
 * Site name and site code are left out when not recorded (never invented); a code equal to the name is not repeated. */
export function numberedDownloadName(input:{number:string;customer?:string;site?:string;siteCode?:string;extension:string}){
 const parts=[filenamePart(input.number,'Document',90),filenamePart(input.customer,'Customer not recorded',60)];
 const site=filenamePart(input.site,'',60),code=filenamePart(input.siteCode,'',30);
 if(site)parts.push(site);
 if(code&&code.toLowerCase()!==site.toLowerCase())parts.push(code);
 return `${parts.join(' - ')}.${input.extension.replace(/[^a-z0-9]/gi,'').toLowerCase()||'pdf'}`;
}
/** Documents whose own number names them; any other document adds its type after the number it carries
 * ("IPO-163 PT Breakup"), so files sharing a number never share a name. */
const namedByNumber=new Set(['Quotation','IPO and PT','IPO','BOQ','Delivery Order','Invoice']);
export function downloadName(input:DownloadName){
 const type=filenamePart(input.documentType,'Document',50),marker=type.match(/ (DRAFT|Preview)$/)?.[1];
 const number=input.reference?.trim()?cleanDocumentNumber(input.reference.trim()):'';
 // Version 1 is the first document: no suffix; version 2 is -R1 (numbers already carry their own -R).
 const revision=Number.isInteger(input.revision)&&input.revision!>1?`-R${input.revision!-1}`:'';
 const first=!number?`${type} ${input.alias??fallbackDownloadReference(input.identity)}${revision}`:namedByNumber.has(marker?type.slice(0,-marker.length-1):type)?(marker?`${number} ${marker}`:number):`${number} ${type}`;
 return numberedDownloadName({number:first,customer:input.customerName??input.customer,site:input.site,siteCode:input.siteCode,extension:input.extension});
}
export function filenameFromDisposition(header:string|null){
 if(!header)return undefined;const encoded=header.match(/filename\*=UTF-8''([^;]+)/i);if(encoded){try{return decodeURIComponent(encoded[1].trim())}catch{}}
 return header.match(/filename="([^"]+)"/i)?.[1]??header.match(/filename=([^;]+)/i)?.[1]?.trim();
}
