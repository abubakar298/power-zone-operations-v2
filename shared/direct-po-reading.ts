/** Evidence suggestions only. Agreement quantities and prices remain authoritative. */
export const directPoFields = [
 ['siteCode','Branch code'],['siteName','Site / branch name'],['siteAddress','Installation address'],
 ['siteContact','Site contact'],['sitePhone','Site contact number'],
 ['approvalContact','Approval sender'],['approvalEmail','Approval sender email'],
 ['approvalDate','Approval date'],['approvalSubject','Email subject / approval reference'],
 ['contactPerson','Customer contact'],['phone','Customer contact number'],['email','Customer email'],
 ['billingAddress','Billing address'],['paymentContact','Payment contact'],['paymentPhone','Payment contact number'],
 ['ipoNumber','IPO number'],['orderNumber','Order number (unit / total)'],['poNumber','Customer PO reference'],
] as const;
export type DirectPoValues=Record<typeof directPoFields[number][0],string>;
export function directPoSuggestions(text:string,customer:any={}):DirectPoValues {
 const value=Object.fromEntries(directPoFields.map(([key])=>[key,''])) as DirectPoValues;
 const codes=[...new Set([...text.matchAll(/branch\s*(?:code|id|no\.?)\s*[:#-]?\s*(\d{1,8}|[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\b/gi)].map(m=>m[1]))];
 if(codes.length===1)value.siteCode=/^\d{1,4}$/.test(codes[0])?codes[0].padStart(4,'0'):codes[0];
 value.siteName=text.match(/branch[ \t]+name[ \t]*(?:[:#-][ \t]*)?([^\r\n]+)/i)?.[1]?.trim()??'';
 const subject=text.match(/(?:Subject:\s*)?(?:RE:\s*)?UPS Problem\s*:\s*([^\r\n]+)/i)?.[1]?.trim().replace(/\s*1 message.*$/i,'')??'';
 if(!value.siteName)value.siteName=subject;
 value.approvalSubject=subject?'UPS Problem: '+subject:(text.match(/Subject:\s*([^\r\n]+)/i)?.[1]?.trim()??'');
 const sender=text.match(/(?:^|\n)(?:From:\s*)?([^\n<>]+?)\s*<([^<>\s]+@[^<>\s]+)>\s*(?:Thu|Wed|Tue|Mon|Fri|Sat|Sun|Sent:)/i);
 if(sender){value.approvalContact=sender[1].trim();value.approvalEmail=sender[2];}
 const date=text.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})/i);
 if(date){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(date[1].toLowerCase())+1;value.approvalDate=`${date[3]}-${String(month).padStart(2,'0')}-${date[2].padStart(2,'0')}`;}
 const poc=text.match(/POC\s*:\s*([A-Za-z .'-]+?)\s*[=:]\s*(\+?\d[\d ()-]{7,22})/i);
 if(poc){value.siteContact=poc[1].trim();value.sitePhone=poc[2].trim();}
 if(!value.siteContact)value.siteContact=text.match(/\bPOC\s*:\s*([^"\r\n]+)/i)?.[1]?.trim()??'';
 if(!value.sitePhone)value.sitePhone=text.match(/Deliver\s+To\s+Contact\s+No\.?\s*[:=]?\s*(\+?\d[\d ()-]{7,22})/i)?.[1]?.trim()??'';
 value.siteAddress=text.match(/(?:installation|delivery|site)[ \t]+address[ \t]*(?:[:=][ \t]*)?([^\r\n]+)/i)?.[1]?.trim()??'';
 // UBL Central Office/0999 is an ordering placeholder. The delivery branch
 // identifies the installation; keep its printed branch code and full address.
 const deliveryBranch=value.siteAddress.match(/\bUBL[ \t]+AMEEN[ \t]+(.+?)(?=,?[ \t]+[A-Za-z -]+[ \t]+REGION\b|[ \t]+OSI[ -]?\d|[\"\r\n]|$)/i)?.[1]?.trim();
 if(deliveryBranch){
  const name=deliveryBranch.replace(/\s+BRANCH\s+/i,', ').replace(/\s+BRANCH$/i,'').replace(/[, -]+$/,'').trim();
  if(name)value.siteName='UBL Ameen '+name.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
 }
 // Signature addresses are candidates for review, never mistaken for HQ billing details.
 if(!value.siteAddress)value.siteAddress=text.match(/Meezan Bank Limited,\s*(\d+[- ][^\r\n]*?Lahore)/i)?.[1]?.trim()??'';
 for(const [field,source] of [['contactPerson','contact_person'],['phone','phone'],['email','email'],['billingAddress','address'],['paymentContact','contact_person'],['paymentPhone','phone']] as const)value[field]=customer[source]??'';
 return value;
}
export function directPoChanges(before:Record<string,string>,after:Record<string,string>){
 return directPoFields.filter(([key])=>(before[key]??'')!==(after[key]??'')).map(([field,label])=>({field,label,before:before[field]??'',after:after[field]??''}));
}

export function validOrderPosition(value:string){const m=value.match(/^([1-9]\d{0,5})\/([1-9]\d{0,5})$/);return !!m&&BigInt(m[1])<=BigInt(m[2]);}

/** Missing capacity means use the selected agreement; explicit conflicting capacity needs review. */
export function directPoCapacityIssues(text:string,configuration:string){
 const expected=configuration.match(/UPS-(\d+)-(\d+)$/);if(!expected)return [];
 const latest=text.split(/\n\s*(?:From:|-----Original Message-----)/i)[0];
 const issues:string[]=[];
 const counted=latest.replace(/(\d+)\s*(?:lithium\s*)?batter(?:y|ies)\s*(?:of|x|×)?\s*(\d+(?:\.\d+)?)\s*kWh?/gi,(_,n,k)=>`${Number(n)*Number(k)} kWh battery`);
 const batteryText=counted.replace(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*kWh?\s*(?:lithium\s*)?batter(?:y|ies)/gi,(_,n,k)=>`${Number(n)*Number(k)} kWh battery`);
 const batteries=[...new Set([...batteryText.matchAll(/(\d+(?:\.\d+)?)\s*kWh?\s*(?:LV\s*)?(?:lithium\s*)?(?:batter(?:y|ies)|bank)/gi)].map(m=>Number(m[1])))];
 if(batteries.some(k=>k!==Number(expected[2])))issues.push(`Email/evidence battery capacity differs from the selected ${expected[2]} kWh agreement. Review the accepted quotation.`);
 const inverters=[...new Set([...latest.matchAll(/(\d+(?:\.\d+)?)\s*kW\s*(?:single[- ]phase\s*)?(?:inverter|inv\b)/gi)].map(m=>Number(m[1])))];
 if(inverters.some(k=>k!==Number(expected[1])))issues.push(`Email/evidence inverter capacity differs from the selected ${expected[1]} kW agreement.`);
 return issues;
}

/** 0999 alone is a shared construction placeholder; other codes identify one site. */
export function directPoSiteMatches(site:any,customerId:number,code:string,name:string,address:string,sharedUblConstruction=false){
 const normalized=(v:string)=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
 if(site.customer_id!==customerId||normalized(site.code)!==normalized(code))return false;
 if(code.trim()!=='0999'||!sharedUblConstruction)return true;
 return normalized(site.name)===normalized(name)&&normalized(site.location)===normalized(address);
}
