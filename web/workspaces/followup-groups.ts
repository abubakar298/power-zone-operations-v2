import { coordinationBuckets } from "./project-routes.js";

export function isCustomerFollowup(record: any) {
  return record.coordinationBucket === coordinationBuckets[5] &&
    !["issued", "declined"].includes(record.stage);
}

export function followupGroups(records:any[]){const groups=new Map<string,any[]>();for(const r of records){if(!isCustomerFollowup(r)||r.stage!=='customer_tracking'||!r.data.ublSurveyPackageId||r.data.readySendUnbound||r.data.headsupReceived)continue;const key=r.data.ublSurveyPackageId;groups.set(key,[...(groups.get(key)??[]),r]);}return [...groups].filter(([,sites])=>sites.length>0&&(sites[0].data.surveyPackageSiteCount??sites.length)>1).map(([id,sites])=>({id,customer:sites[0].customer,sites}));}
