import {followupGroups} from './followup-groups.js';
import {coordinationBucket as legacyBucket} from './tasks.js';
import {designBuckets,coordinationBuckets,visibleCoordinationBuckets,iposSharedBucket} from './project-routes.js';
export function bucketCounts(department:'design'|'coordination',records:any[],legacy:any[]=[]):Record<string,number>{
 const designStages=['survey_requested','survey_scheduled','report_received','technical_review','technical_revision'];
 const relevant=department==='coordination'?records.filter(r=>!designStages.includes(r.stage)&&!['issued','declined'].includes(r.stage)):records;
 return Object.fromEntries((department==='design'?designBuckets:visibleCoordinationBuckets).map(bucket=>[bucket,bucket===iposSharedBucket?records.filter(r=>r.stage==='issued'&&r.data.ipoShared).length:department==='coordination'&&bucket===coordinationBuckets[5]?relevant.filter(r=>r.coordinationBucket===bucket).length+legacy.filter(t=>legacyBucket(t)===bucket).length:relevant.filter(r=>r[department==='design'?'designBucket':'coordinationBucket']===bucket&&r.stage!=='issued'&&(department!=='coordination'||bucket!==coordinationBuckets[0]||r.stage==='request_review')).length+(department==='coordination'&&bucket!==coordinationBuckets[0]&&bucket!==coordinationBuckets[1]?legacy.filter(t=>legacyBucket(t)===bucket).length:0)]));
}
