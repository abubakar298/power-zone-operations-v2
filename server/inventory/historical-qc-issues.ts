import ledger from './approved-site-ledger.json' with {type:'json'};
import {reviewedStockLogQcIssue} from './reviewed-stock-log-qc-issues.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';

type SignedDoItem = readonly [itemId: string, description: string, issued: string, unit?: string];
type SignedDo = {reference: string; items: readonly SignedDoItem[]};

// The reviewed delivery orders refer to existing ledger events. An exact board
// ID and IPO/order protect sites that share an IPO number.
const links: Record<string, {ipo: string; orders: string[]; ledgerIdentity?: {ipo: string; site: string}; review?: string; signedDeliveries?: readonly SignedDo[]}> = {
  'live-ipo:ddb6711e-97b3-41a2-9994-22c768cf590c': {ipo:'CHP-338(20/60)',orders:['DO778-01','DO785-01']},
  // CPZ-DO-808 names the exact IPO/order and confirms all five baseline rows.
  'registered-MBL:CHP-338:60-site order:22/60': {
    ipo:'CHP-338(22/60)',orders:['DO808-KHI-BASELINE'],
    ledgerIdentity:{ipo:'',site:'MBL New Fruit Market Hyderabad'},
    review:'CPZ-DO-808 includes two handwritten items absent from the warehouse issue record: 1 × 60×60 channel duct and 10 ft of flexible pipe. Confirm their source before verifying usage.',
  },
  'registered-UBL:SOLAR:349': {
    ipo:'CHP-349',orders:['DO810'],
    // Both additional DOs are signed, dated 23 October 2026 and name Noorkot branch 2125.
    // These are historical QC issue quantities. They do not post warehouse movements.
    signedDeliveries:[
      {reference:'CPZ-DO-815',items:[
        ['CH-PCS-HYB-3P-015','15 kW hybrid inverter','2'],
        ['CH-BAT-HV-05 KW','5 kWh high-voltage battery','8'],
        ['CH-BMS-HV','High-voltage BMS','2'],
        ['CH-DB Box 30x36','Distribution box 30 × 36','1'],
        ['CH-BRK-AC-100A/4P-CC','100 A 4-pole AC breaker','6'],
        ['CH-Duct Slot 100x100','Slotted duct 100 × 100','4'],
        ['CH-Duct Slot 60x60','Slotted duct 60 × 60','4'],
        ['CH-Flex Pipe 1','Flexible pipe 1 inch','25','ft'],
        ['CH-Flex Pipe 2','Flexible pipe 2 inch','25','ft'],
        ['CH-Pvc Pipe 1.5 Inch','PVC pipe 1.5 inch','15','length'],
        ['CH-Pvc Bend 1.5 Inch','PVC bend 1.5 inch','20'],
        ['CH-Pvc Elbow 1.5 Inch','PVC elbow 1.5 inch','20'],
        ['CH-Pvc Socket 1.5 Inch','PVC socket 1.5 inch','20'],
        ['Clamp 1"','Clamp 1 inch','35'],
      ]},
      {reference:'CPZ-DO-816',items:[
        ['CH-18 Way Box','18-way distribution box','1'],
        ['CH-8 Way Box','8-way distribution box','1'],
        ['CH-DB Box 14x20','Distribution box 14 × 20','1'],
        ['CH-CBL-AC-16MM/4C-PK','16 mm² 4-core AC cable','13','m'],
        ['CH-CBL-AC-25MM/4C-PK','25 mm² 4-core AC cable','30','m'],
        ['CH-CBL-DC-6MM/1C-R/PK','6 mm² red DC cable','165','m'],
        ['CH-CBL-DC-6MM/1C-B/PK','6 mm² black DC cable','166','m'],
        ['CH-CBL-ERT-10MM/1C-PK','10 mm² earthing cable','55','m'],
        ['CH-CBL-ERT-6MM/1C-PK','6 mm² earthing cable','70','m'],
        ['CH-CBL-ERT-2.5MM/1C-PK','2.5 mm² earthing cable','20','m'],
        ['CH-CHG-100A-ROTARY','100 A rotary changeover','1'],
        ['CH-BRK-DC-25A/4P','25 A 4-pole DC breaker','8'],
        ['CH-FUSEH-1P','1-pole fuse with holder','4'],
        ['CH-SPD-AC-4P','4-pole AC surge protection device','1'],
        ['CH-SPD-DC-2P','2-pole DC surge protection device','4'],
        ['CH-CHG-BOX','Changeover box','1'],
        ['Earthing Thimble 2.5MM','2.5 mm² earthing thimble','150'],
        ['Breaker Strip','Breaker strip','5','ft'],
        ['Black Screw 1.5 inch+Washel','Black screw 1.5 inch with washer','50'],
        ['Black Screw 2 inch+Washel','Black screw 2 inch with washer','50'],
        ['Gatti','Gatti','2'],
        ['Self Screw 1/2 inch','Self screw 1/2 inch','150'],
        ['CH-PVC-TAPE','Insulation tape (red, blue, yellow and black)','8'],
        ['CH-MC4','MC4 1500 V connector','12'],
        ['Thimble 25MM','25 mm² thimble','30'],
        ['Thimble 16MM','16 mm² thimble','70'],
        ['Rawal Bolt 3 Sotar','Rawal bolt 3 sotar','24'],
        ['Cat 6','Cat 6 cable','10','m'],
        ['Cable Tie 12 inch','Cable tie 12 inch','4'],
        ['RJ45','RJ45 connector','6'],
        ['Telenor 4G','Telenor 4G device','1'],
      ]},
    ],
  },
  'registered-UBL:UPS:117/250': {ipo:'CHP-163(117/250)',orders:['DO748-01']},
  'registered-UBL:UPS:143/250': {ipo:'CHP-163(143/250)',orders:['DO777-01']},
  'registered-UBL:UPS:153/250': {ipo:'CHP-163(153/250)',orders:['DO734-01']},
  'registered-UBL:UPS:167/250': {ipo:'CHP-163(167/250)',orders:['DO718-01']},
  'registered-UBL:UPS:180/250': {ipo:'CHP-163(180/250)',orders:['DO775-01']},
  'registered-UBL:UPS:182/250': {ipo:'CHP-163(182/250)',orders:['DO795-01']},
  'registered-UBL:UPS:73/250': {ipo:'CHP-163(73/250)',orders:['DO733-01'],review:'Check delivery coverage against the signed DO. The ledger assigns DO709-01 to a different site.'},
  'registered-UBL:UPS:98/250': {ipo:'CHP-163(98/250)',orders:['DO438-01']},
  'registered-UBL:SOLAR:232': {ipo:'CHP-232',orders:['DO617-01']},
  'registered-UBL:SOLAR:310': {ipo:'CHP-310',orders:['DO768-01']},
  'registered-UBL:SOLAR:307': {ipo:'CHP-307',orders:['DO769-01']},
  'registered-UBL:UPS:140/250': {ipo:'CHP-163(140/250)',orders:['DO770-01']},
  'registered-UBL:UPS:141/250': {ipo:'CHP-163(141/250)',orders:['DO717-01']},
};

const ipoKey = (label: string) => label.toUpperCase().replace(/[\s·()]/g,'');

// Signed delivery copies provide item quantities for QC, independently of the
// warehouse ledger. Use the canonical order confirmed by Management.
const signedDeliveryIssues = new Map<string, {
  ipo: string;
  reference: string;
  items: readonly SignedDoItem[];
}>([
  ['registered-MBL:CHP-233:20-site order:3/20', {
    ipo: 'CHP-233(3/20)',
    // The signed copy prints CHP-338(15/60) but names New Chaali branch 0126.
    reference: 'CPZ-DO-818',
    items: [
      ['CH-PCS-HYB-1P-006', '6 kW hybrid inverter', '1'],
      ['CH-BMS-LV', 'Low-voltage BMS', '1'],
      ['CH-BAT-LV-05 KW', '5 kWh low-voltage battery', '2'],
      ['CH-VPD-63A/2P', 'Voltage protection device', '1'],
      ['CH-5WAY-DB', '5-way distribution box', '1'],
      ['CH-Duct Slot 60x60', 'Slotted duct 60 × 60', '1'],
      // The installation material sheet classifies flexible pipe as a local purchase.
    ],
  }],
  ['registered-UBL:UPS:20/250', {
    ipo: 'CHP-163(20/250)',
    reference: 'CPZ-DO-0176',
    items: [
      ['CH-BMS-LV', 'Low-voltage BMS', '1'],
      ['CH-BAT-LV-05 KW', '5 kWh low-voltage battery', '2'],
      ['CH-PCS-HYB-1P-006', '6 kW hybrid inverter', '1'],
      ['CH-VPD-63A/2P', 'Voltage protection device', '1'],
    ],
  }],
]);

function signedDoLines(boardId: string, {reference, items}: SignedDo) {
  return items.map(([itemId, description, issued, unit = 'piece'], index) => ({
    key: 'signed-do:' + boardId + ':' + reference + ':' + (index + 1),
    itemId, description, issued, unit, reference,
    variable: materialDocumentPolicy({itemId, description}).variableDispatch,
  }));
}

export function hasReviewedHistoricalIssues(boardId: string): boolean {
  return signedDeliveryIssues.has(boardId)||Object.hasOwn(links,boardId)||!!reviewedStockLogQcIssue(boardId);
}

export function historicalQcIssues(boardId: string, ipo: string) {
  const signed = signedDeliveryIssues.get(boardId);
  if (signed) {
    const canonicalIpo = ipoKey(ipo.replace(/([·(\s])0+(?=\d+\/)/g, '$1'));
    if (canonicalIpo !== ipoKey(signed.ipo)) return null;
    const lines = signedDoLines(boardId, signed);
    return {lines, signature: JSON.stringify(lines.map(line => [line.key, line.issued])), review: undefined};
  }
  const later=reviewedStockLogQcIssue(boardId);
  if(later){
    if(ipoKey(ipo)!==ipoKey(later.ipo))return null;
    const lines=later.items.map(([itemId,description,issued,unit='piece'],index)=>({
      key:'chint-stock:'+later.document+':'+(later.firstRow+index),itemId,description,unit,issued,
      reference:later.document,variable:materialDocumentPolicy({itemId,description}).variableDispatch,
    }));
    return {lines,signature:JSON.stringify(lines.map(line=>[line.key,line.issued])),review:later.review};
  }
  if(!Object.hasOwn(links,boardId))return null;
  const link=links[boardId];
  if(!link||ipoKey(ipo)!==ipoKey(link.ipo))return null;
  const events=ledger.events.filter(event=>event.kind==='issue'&&event.ipo===(link.ledgerIdentity?.ipo??link.ipo)&&(!link.ledgerIdentity||event.site===link.ledgerIdentity.site)&&link.orders.includes(event.document));
  if(!link.orders.every(order=>events.some(event=>event.document===order)))return null;
  const lines=events.map(event=>({
    key:event.id,itemId:event.itemId,description:event.description,unit:event.unit,
    issued:event.quantity,reference:event.document,variable:materialDocumentPolicy(event).variableDispatch,
  }));
  for(const delivery of link.signedDeliveries??[])lines.push(...signedDoLines(boardId,delivery));
  const signature=JSON.stringify(lines.map(line=>[line.key,line.issued]));
  return {lines,signature,review:link.review};
}
