/** Standing exception: order numbers typed wrongly on issued IPOs, read correctly in the order-slot count.
 *
 * What it fixes: IPO CHP-233 (MBL, New Chaali Barnch, branch code 0126) was issued on 23 Oct 2026 with order
 * "3/60". It is order 3 of the 20-site CHP-233 batch (the reviewed register lists it as 3/20), so the
 * Coordination → Cancelled Sites window showed a second, wrong "CHP-233 · 60 slots" row.
 * Records affected: that one IPO only, matched by customer, IPO number, typed order and branch code.
 * Date: 26 Nov 2026. Approved by: the user (owner instruction in chat, 26 Nov 2026), after a read-only lookup
 * confirmed it is the only IPO numbered CHP-233.
 *
 * Only the order-slot count (server/project-workflow/order-slots.ts) reads this list. The issued IPO, its
 * printed order number and every other report are unchanged. */
type Correction={customer:string;ipo:string;typed:string;siteCode:string;readAs:string};
const corrections:readonly Correction[]=[
 {customer:'MBL',ipo:'CHP-233',typed:'3/60',siteCode:'0126',readAs:'3/20'},
];

const key=(value:unknown)=>String(value??'').trim().toUpperCase();

/** The order number to count for an issued IPO: the corrected one if listed above, otherwise as typed. */
export function correctedOrderNumber(ipo:{customer:unknown;ipo:unknown;order:unknown;siteCode:unknown}):string{
 const match=corrections.find(c=>c.customer===key(ipo.customer)&&c.ipo===key(ipo.ipo)&&c.typed===key(ipo.order)&&c.siteCode===key(ipo.siteCode));
 return match?match.readAs:String(ipo.order??'');
}
