/** Uses the same product families as the approved engineering brand selectors. */
export function productBrandCategory(key:string):string|undefined {
 if(key==='Solar PV Modules')return 'Solar Panel';
 if(/^HYB-/.test(key))return 'Inverter';
 if(/^(BAT-|CH-BMS-|BMS-)/.test(key))return 'Battery & BMS';
 if(/cable/i.test(key))return 'Cable';
 if(/MCB|MCCB|SPD|VPD|Changeover|Smart Meter|DC Breaker|Fuse|Enclosure/i.test(key))return 'Switchgear';
 return undefined;
}
