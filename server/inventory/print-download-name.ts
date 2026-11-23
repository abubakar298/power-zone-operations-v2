/** Download-name details of a printed inventory document (user request, 23 Nov 2026: every file is named
 * "<number> - <customer> - <site name> - <site code>"). The number is the document's own (DO, gate pass, transfer…);
 * a preparation reference such as "Preparation <id> / v2" is not a number, so drafts keep their stable alias.
 * The customer is given only when every listed site belongs to the same one. */
export function printDownloadDetails(model:{reference?:string;sites?:{customer?:string}[]}){
 const reference=model.reference?.trim()&&!/preparation\b/i.test(model.reference)?model.reference.trim():undefined;
 const customers=[...new Set((model.sites??[]).map(s=>s.customer?.trim()).filter(Boolean))];
 return {...(reference?{reference}:{}),...(customers.length===1?{customer:customers[0]}:{})};
}
