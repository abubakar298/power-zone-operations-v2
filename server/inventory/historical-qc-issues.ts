import ledger from './approved-site-ledger.json' with {type:'json'};
import {reviewedStockLogQcIssue} from './reviewed-stock-log-qc-issues.js';
import {materialDocumentPolicy} from '../../shared/material-documents.js';

// The reviewed delivery orders refer to existing ledger events. An exact board
// ID and IPO/order protect sites that share an IPO number.
const links: Record<string, {ipo: string; orders: string[]; ledgerIdentity?: {ipo: string; site: string}; review?: string}> = {
  'live-ipo:ddb6711e-97b3-41a2-9994-22c768cf590c': {ipo:'CHP-338(20/60)',orders:['DO778-01','DO785-01']},
  // CPZ-DO-808 names the exact IPO/order and confirms all five baseline rows.
  'registered-MBL:CHP-338:60-site order:22/60': {
    ipo:'CHP-338(22/60)',orders:['DO808-KHI-BASELINE'],
    ledgerIdentity:{ipo:'',site:'MBL New Fruit Market Hyderabad'},
    review:'CPZ-DO-808 includes two handwritten items absent from the warehouse issue record: 1 × 60×60 channel duct and 10 ft of flexible pipe. Confirm their source before verifying usage.',
  },
  'registered-UBL:SOLAR:349': {ipo:'CHP-349',orders:['DO810'],review:'Confirm the remaining delivered materials against the signed DO. DO810 records the 49 panels only.'},
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

export function hasReviewedHistoricalIssues(boardId: string): boolean {
  return Object.hasOwn(links,boardId)||!!reviewedStockLogQcIssue(boardId);
}

export function historicalQcIssues(boardId: string, ipo: string) {
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
  const signature=JSON.stringify(lines.map(line=>[line.key,line.issued]));
  return {lines,signature,review:link.review};
}
