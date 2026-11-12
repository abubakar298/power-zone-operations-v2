/** A batch site as the Batch planning page holds it. The server adds display-only facts to each loaded
 * site (for example installationDocumentsAtKarachi); they are never part of a saved batch. */
export type BatchStopDraft={kind?:'delivery'|'labour'|'both';siteId:string;siteVersion:number;order:number;plannedDate:string;start?:string;end?:string;pocName?:string;pocPhone?:string;[displayOnly:string]:unknown};

/** The exact stop fields a batch save accepts: display-only facts are left out, times are not used,
 * and each site carries its current version. Sending anything else makes the whole save fail. */
export function batchStopsForSave(stops:BatchStopDraft[],currentVersion:(siteId:string)=>number|undefined){
 return stops.map(s=>({
  siteId:s.siteId,
  siteVersion:currentVersion(s.siteId)??s.siteVersion,
  ...(s.kind?{kind:s.kind}:{}),
  order:s.order,
  plannedDate:s.plannedDate,
  start:'',
  end:'',
  ...(s.pocName!==undefined?{pocName:s.pocName}:{}),
  ...(s.pocPhone!==undefined?{pocPhone:s.pocPhone}:{}),
 }));
}
