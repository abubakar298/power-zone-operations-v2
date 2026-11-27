import {Decimal} from 'decimal.js';
import {invoiceCategory} from './accounts-invoice-display.js';
type Row=Record<string,any>;
/** Site type filter for Payments to Record (user request, agreed with Abu Bakar, 24 Nov 2026): a site's UPS or
 * Solar invoices and its extra-cable invoices are shown together, so Accounts sees all of one site in one place. */
export const siteTypes=[['ups-only','UPS only'],['ups-cable','UPS + Extra Cable'],['solar-only','Solar only'],['solar-cable','Solar + Extra Cable']] as const;
export type SiteType=typeof siteTypes[number][0];
export const isSiteType=(value:unknown):value is SiteType=>siteTypes.some(([id])=>id===value);
type SiteFlags={ups:boolean;solar:boolean;cable:boolean};
const ipoKey=(value:unknown)=>String(value??'').split(' · ')[0].trim().toUpperCase().replace(/\s+/g,'');
/** A site is linked by exact customer + IPO number, never by a similar-looking site name. A cable invoice names the
 * IPO of every site it covers ("CHP-1 / CHP-2" on older multi-site invoices). */
export function siteKeys(row:Row):string[]{
 const ipos=invoiceCategory(row)==='extra-cable'?String(row.ipo??'').split(' / '):[String(row.ipo??'')];
 return [...new Set(ipos.map(ipoKey).filter(Boolean).map(ipo=>`${row.customer??''}|${ipo}`))];
}
/** What each site has among these invoice rows (UPS, Solar, extra cable). */
export function siteIndex(rows:Row[]){
 const sites=new Map<string,SiteFlags>();
 for(const row of rows){
  const category=invoiceCategory(row);
  for(const key of siteKeys(row)){
   const site=sites.get(key)??{ups:false,solar:false,cable:false};
   if(category==='ups')site.ups=true;else if(category==='solar')site.solar=true;else if(category==='extra-cable')site.cable=true;
   sites.set(key,site);
  }
 }
 return sites;
}
const mainOf=(type:SiteType)=>type.startsWith('ups')?'ups':'solar';
const withCable=(type:SiteType)=>type.endsWith('-cable');
/** The site this row is listed under for a site type, or undefined when the row is not part of it. */
export function siteFor(row:Row,type:SiteType,sites:Map<string,SiteFlags>){
 const main=mainOf(type),category=invoiceCategory(row);
 if(category!==main&&!(withCable(type)&&category==='extra-cable'))return undefined;
 return siteKeys(row).find(key=>{const site=sites.get(key);return !!site&&site[main]&&site.cable===withCable(type);});
}
export function matchesSiteType(row:Row,type:string|undefined,sites:Map<string,SiteFlags>){
 return !type||(isSiteType(type)&&siteFor(row,type,sites)!==undefined);
}
export interface SiteGroup{key:string;site:string;ipo:string;customer:string;pending:string|null;rows:Row[];sharedCable:Row[]}
/** Rows of one site together: its UPS/Solar invoices first, then its extra-cable invoices. Groups keep the order in
 * which their first row appears. An older cable invoice covering several sites is listed once, under the first of
 * its sites in the list, and counted once in the totals. */
export function groupBySite(rows:Row[],type:SiteType,sites:Map<string,SiteFlags>):SiteGroup[]{
 const groups=new Map<string,SiteGroup>();
 for(const row of rows){
  const key=siteFor(row,type,sites);if(!key)continue;
  const group=groups.get(key)??{key,site:'',ipo:key.split('|').slice(1).join('|'),customer:String(row.customer??''),pending:'0',rows:[],sharedCable:[]};
  group.rows.push(row);groups.set(key,group);
 }
 const main=mainOf(type);
 for(const group of groups.values()){
  group.rows.sort((a,b)=>Number(invoiceCategory(a)!==main)-Number(invoiceCategory(b)!==main));
  const first=group.rows.find(r=>invoiceCategory(r)===main)??group.rows[0];
  group.site=String(first.site??'');group.ipo=String(first.ipo??group.ipo).split(' · ')[0];
  group.sharedCable=group.rows.filter(r=>invoiceCategory(r)==='extra-cable'&&siteKeys(r).length>1);
  group.pending=group.rows.some(r=>r.pending==null)?null:group.rows.reduce((sum,r)=>sum.plus(r.pending),new Decimal(0)).toFixed(2);
 }
 return [...groups.values()];
}
