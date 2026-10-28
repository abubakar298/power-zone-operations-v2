/** Owner's document split: warehouse dispatch records everything actually sent;
 * customers confirm measured cables/pipes/ducts, while consumables remain on the
 * internal installation reconciliation. This is not stock-availability authority. */
export type MaterialDocumentGroup='fixed'|'customer-variable'|'internal-variable'|'non-stock'|'unclassified';
export type MaterialDocumentLine={itemId:string;description:string};

const customerIds=new Set([
 'CH-FLEX PIPE 1','CH-PVC PIPE 1.5 INCH',
 'CH-DUCT SLOT 40X40','CH-DUCT SLOT 60X60','CH-DUCT SLOT 100X100',
]);
const internalIds=new Set([
 'CH-CABLE-TIES','CH-PVC-TAPE','CH-PVC-BENDS-SOCKETS','CH-PVC-ELBOW',
 'CH-PVC-MISC-ACC','CH-JBOX-PVC-1.5IN','CH-MIX ITEMS ALL','CH-MC4',
 'CH-CLAMPS','CH-GLAND-PG45','CH-GLAND-PG65','CH-SLEEVE',
]);
// A fixed item's wording can mention its cabling or fittings. Its stock identity
// must not migrate to the variable module just because a description is verbose.
const fixedIdentity=/^CH-(?:PCS-|BAT-|BMS-|BRK-|BREAK|SPD-|CHG-|CHANGE|SM-3P$|SOLAR\s*PLATES?\b|STRUCTURE\b|EARTHING$|SOLARBOX-|\d+\s*WAY\b|C&I\b)/;
const internalDescription=/\b(?:cable\s+ties?|(?:pvc|insulation)\s+tapes?|lugs?|thimbles?|screws?|rawl?\s*bolts?|rawal\s+bolts?|clamps?|glands?|sleeves?|MC4|(?:pvc\s+)?(?:bends?|elbows?|sockets?)|(?:pvc\s+)?(?:pipe\s+)?(?:clips?|hooks?))\b/i;
const customerDescription=/\b(?:cables?|wires?|ducts?|(?:pvc|flex(?:ible)?)\s+pipes?)\b/i;

export function materialDocumentPolicy(line:MaterialDocumentLine){
 const id=line.itemId.trim().toUpperCase(),description=line.description.trim();
 let group:MaterialDocumentGroup;
 if(/\b(?:genset|generator)\s+synch(?:roni[sz](?:ation|ing))?\b/i.test(description)||/^CH-(?:GENSET-SYNC|GEN-SYNC)$/.test(id))group='non-stock';
 else if(fixedIdentity.test(id))group='fixed';
 else if(internalIds.has(id))group='internal-variable';
 else if(customerIds.has(id)||/^CH-CBL-/.test(id))group='customer-variable';
 else if(internalDescription.test(description))group='internal-variable';
 else if(customerDescription.test(description))group='customer-variable';
 else group=id?'fixed':'unclassified';
 return {
  group,
  variableDispatch:group==='customer-variable'||group==='internal-variable',
  customerUsageSignoff:group==='customer-variable',
  installationReconciliation:group==='fixed'||group==='internal-variable',
  approvedQuantityLocked:id==='CH-EARTHING',
  classificationRequired:group==='unclassified',
 };
}
