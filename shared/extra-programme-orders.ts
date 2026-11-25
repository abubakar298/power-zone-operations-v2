import {validOrderPosition} from './direct-po-reading.js';

/** Extra orders above a bank programme's target (owner request, 25 Nov 2026).
 * The UBL UPS 250 programme has no hard ceiling. When more orders come than its original target of 250, they are
 * issued as "251/250", "252/250" and so on: the second number stays the original target on every order, because
 * the portal recognises the programme by it, and an order above it is shown as "Extra order (250+)". No approval
 * is needed. Slots freed by cancelled sites are used first (server/project-workflow/order-slots.ts
 * requireFreedSlotsFirst). Only the programmes listed here grow; every other programme keeps unit ≤ total.
 * The database insert guard (migration 312_ubl_ups_extra_orders.sql) follows the same list. */
export const growingProgrammes=[{customer:'UBL',configurationKey:'UBL-UPS-6-10',target:250}] as const;

const position=(value:string)=>{const m=value.trim().match(/^([1-9]\d{0,5})\/([1-9]\d{0,5})$/);return m?{unit:Number(m[1]),total:Number(m[2])}:null;};

/** The listed programme an order number belongs to, by agreement key or bank, when its total is that programme's target. */
export function growingProgramme(order:string|null|undefined,from:{configurationKey?:string|null;customer?:string|null}){
 const p=position(String(order??''));if(!p)return null;
 const bank=String(from.customer??'').trim().toUpperCase(),key=String(from.configurationKey??'').trim();
 return growingProgrammes.find(g=>g.target===p.total&&(key?g.configurationKey===key:bank===g.customer))??null;
}

/** A valid "unit/total" order number: unit ≤ total, or any unit above it for a growing programme. */
export function validProgrammeOrder(order:string,from:{configurationKey?:string|null;customer?:string|null}){
 return validOrderPosition(order)||!!growingProgramme(order,from);
}

/** "251/250" → true. Only growing programmes can hold such an order. */
export function isExtraOrder(order:string|null|undefined){const p=position(String(order??''));return !!p&&p.unit>p.total;}

/** "Extra order (250+)" for an order above its target; null otherwise. */
export function extraOrderLabel(order:string|null|undefined){const p=position(String(order??''));return p&&p.unit>p.total?`Extra order (${p.total}+)`:null;}
