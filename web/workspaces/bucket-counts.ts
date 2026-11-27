import {surveyRequestInCoordination} from '../../shared/sent-survey-requests.js';
import {isCustomerFollowup} from './followup-groups.js';
import {coordinationBucket as legacyBucket} from './tasks.js';
import {designBuckets,coordinationBuckets,visibleCoordinationBuckets,iposSharedBucket} from './project-routes.js';
// Older commercial tasks (BOQ drafts, approved BOQs awaiting pricing, …) count in every bucket whose page lists them,
// Design Review included, so a counter always matches its list (user report, 27 Nov 2026: Design Review showed 0 above 4 rows).
export function bucketCounts(department:'design'|'coordination',records:any[],legacy:any[]=[]):Record<string,number>{
 const designStages=['survey_requested','survey_scheduled','report_received','technical_review','technical_revision'];
 const relevant=department==='coordination'?records.filter(r=>!designStages.includes(r.stage)&&!['issued','declined'].includes(r.stage)):records;
 return Object.fromEntries((department==='design'?designBuckets:visibleCoordinationBuckets).map(bucket=>[bucket,department==='coordination'&&bucket===coordinationBuckets[0]?records.filter(surveyRequestInCoordination).length:bucket===iposSharedBucket?records.filter(r=>r.stage==='issued'&&r.data.ipoShared&&!r.data.siteCancelled).length:department==='coordination'&&bucket===coordinationBuckets[5]?records.filter(isCustomerFollowup).length+legacy.filter(t=>legacyBucket(t)===bucket).length:relevant.filter(r=>r[department==='design'?'designBucket':'coordinationBucket']===bucket&&r.stage!=='issued'&&(department!=='coordination'||bucket!==coordinationBuckets[0]||r.stage==='request_review')).length+(department==='coordination'&&bucket!==coordinationBuckets[0]?legacy.filter(t=>legacyBucket(t)===bucket).length:0)]));
}
