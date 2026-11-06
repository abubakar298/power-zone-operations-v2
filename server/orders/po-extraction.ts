import type { OrderInput } from "./schema.js";
// UBL's fixed PO template uses day/month/year and tax-inclusive payable values.
// Read printed tax separately; never infer zero-rated supply from a printed zero.
export function ublPoSuggestions(text: string) {
  const unique=(pattern:RegExp)=>{const values=[...new Set([...text.matchAll(pattern)].map(m=>m[1].replace(/,/g,"")))];return values.length===1?values[0]:"";};
  const total=unique(/^\s*Value\s+including\s+Sales\s+Tax\s*[:=]?\s*([0-9][0-9,]*(?:\.\d+)?)\s*$/gim);
  const payable=unique(/^\s*Net\s+Payable\s*[:=]?\s*([0-9][0-9,]*(?:\.\d+)?)\s*(?:PKR|Rs\.?)?\s*$/gim);
  const printedTax=unique(/^\s*Sales\s+Tax\s*[:=]?\s*([0-9][0-9,]*(?:\.\d+)?)\s*$/gim);
  const headers=[...text.matchAll(/\bPO\s+ID\s+PO\s+Date\s*\n\s*(POF\d+)\s+(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/gi)];
  headers.push(...text.matchAll(/\bPO\s+ID\s*[:=]?\s*(POF\d+)\s+PO\s+Date\s*[:=]?\s*(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/gi));
  let poNumber="",orderDate="";
  if(headers.length===1){const m=headers[0];poNumber=m[1];const year=m[4].length===2?`20${m[4]}`:m[4];const iso=`${year}-${m[3]}-${m[2]}`;if(!Number.isNaN(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso)orderDate=iso;}
  return {total:total||payable,printedTax,taxInclusive:/Prices\s+are\s+inclusive\s+of\s+(?:all\s+)?(?:applicable\s+)?Taxes\b/i.test(text),poNumber,orderDate};
}
// Suggest only uniquely labelled fields. Never guess tax IDs, dates or addresses.
export function poSuggestions(text: string): Partial<OrderInput> {
  const out: Partial<OrderInput> = {};
  const fields: [keyof OrderInput, RegExp][] = [
    [
      "poNumber",
      /^(?:customer\s+)?(?:purchase order|po|p\.o\.)\s*(?:number|no\.?|reference|ref\.?)?\s*[:#]\s*(.+)$/i,
    ],
    [
      "orderDate",
      /^(?:(?:purchase order|po)\s+)?(?:order\s+)?date\s*:\s*(.+)$/i,
    ],
    ["customerNtn", /^(?:customer\s+)?ntn\s*(?:no\.?)?\s*:\s*(.+)$/i],
    ["customerStrn", /^(?:customer\s+)?strn\s*(?:no\.?)?\s*:\s*(.+)$/i],
    ["billingAddress", /^(?:billing address|bill to address)\s*:\s*(.+)$/i],
  ];
  for (const [field, pattern] of fields) {
    const values = [
      ...new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.trim().match(pattern)?.[1]?.trim())
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (values.length !== 1) continue;
    const value = values[0];
    if (field === "orderDate") {
      // Numeric day/month dates are ambiguous; accept ISO or a named month only.
      let iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
      if (
        /^(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/.test(
          value,
        )
      ) {
        const d = new Date(value + " UTC");
        if (!Number.isNaN(d.valueOf())) iso = d.toISOString().slice(0, 10);
      }
      if (
        iso &&
        !Number.isNaN(Date.parse(iso)) &&
        new Date(iso).toISOString().slice(0, 10) === iso
      )
        out.orderDate = iso;
    } else if (
      value.length <=
      (field === "billingAddress" ? 1000 : field === "poNumber" ? 100 : 300)
    ) {
      Object.assign(out, { [field]: value });
    }
  }
  return out;
}

/** Explicit capacities in customer UPS PO wording; missing values stay unassumed. */
export function upsPoCapacities(text:string){
 const unique=(regex:RegExp)=>{const values=[...new Set([...text.matchAll(regex)].map(m=>m[1]))];return values.length===1?values[0]:undefined;};
 return {inverterKw:unique(/(\d+(?:\.\d+)?)\s*kW\s*(?:single[- ]phase\s*)?(?:inverter|inv\b)/gi),batteryKwh:unique(/(\d+(?:\.\d+)?)\s*kW(?:h)?\s*(?:lithium\s*)?(?:battery|bank|bess)/gi)};
}
