/** Presentation categories use stock identity first, then the approved description. */
export function materialIssueCategory(line:{itemId:string;description:string;fixedGroup?:string;catalogueGroup?:string}){
 const id=line.itemId.toUpperCase(),text=line.description,group=line.catalogueGroup??'';
 if(/^CH-(PCS|INV|BAT|BMS)-/.test(id))return 'BESS';
 if(line.fixedGroup==='panels'||['CH-STRUCTURE','CH-EARTHING','UNMAPPED:A1'].includes(id)||group==='Solar Panels'||/\bsolar (?:PV )?(?:panels?|plates?|modules?)\b/i.test(text))return 'Panels, Structure and Earthing';
 if(/^CH-CBL-ERT/.test(id)||group==='Cables · Earthing'||/\bearth(?:ing)?\b/i.test(text)&&(/cables?|\d\s*mm/i.test(text))||/^CH-CBL-AC/.test(id)||group==='Cables · AC')return 'AC & Earthing Cables';
 if(/^CH-CBL-(DC|CAT|CNT|COM)/.test(id)||group==='Cables · DC'||group==='Cables · Control & Communication'||/\bDC\s+cables?|communication cables?/i.test(text))return 'DC Cables & Communication Cables';
 if(/\b(?:AC|inverter|load)\s+cables?\b/i.test(text))return 'AC & Earthing Cables';
 if(/^CH-(BRK-DC|SPD-DC|FUSEH)/.test(id)||group==='DC Breakers'||group==='DC Protection · SPDs & Fuses'||/\bdc\s+(?:circuit\s+)?(?:breaker|spd|fuse)/i.test(text))return 'DC Switchgear';
 if(/^CH-(BRK-AC|SPD-AC|CHG)-/.test(id)||['AC Breakers','AC Protection','Changeovers','Contactors'].includes(group)||/\bac\s+(?:circuit\s+)?(?:breaker|switch)|changeover|vpd/i.test(text))return 'AC Switchgear';
 if(group==='DBs & Enclosures'||/\bbox(?:es)?\b/i.test(text))return 'All Boxes';
 if(line.fixedGroup==='bess'||/\b(battery|bms|inverter)\b/i.test(text)||/Chint (?:HV|LV) Systems|Hybrid Inverters|On-grid Inverters/.test(group))return 'BESS';
 return 'Misc Items';
}
