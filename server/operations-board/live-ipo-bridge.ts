/** Pure live-IPO positioning. This creates no document, event, stock movement or database row.
 * Caller must prove the exact saved Operations handoff and supply existing immutable links.
 */
export type LiveIpoPosition={
 ipoId:string;ipoNumber:string;orderNumber:string;siteName:string;customerPo:string;
 operationsIssuanceId:string;createdAt:string;legacy:{id:string;stage:string;stageEnteredAt:string;
 scope:'installation'|'delivery_only'|null;siteType:'Solar'|'BESS'|'Solar + BESS'|'UPS'|null;
 deliveredOn:string|null;installationCompletedOn:string|null;handedOverOn:string|null;closedAt:string|null;expectedDelivery:string|null};
};
export type ExistingBridgeIdentity={verifiedLinks:{ipoId:string;boardSiteId:string}[];boardSites:{id:string;originIpoId?:string}[];unverifiedBoardCandidateIds:string[]};
export type LiveIpoBridgePlan=
 |{action:'retain';boardSiteId:string;ipoId:string}
 |{action:'hold';ipoId:string;reason:string;boardSiteIds:string[]}
 |{action:'prepare';ipoId:string;boardSiteId:string;site:Record<string,unknown>;requiresEvidence:true};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const knownStages=new Set(['ipo_received','planning','delivery','installation','commissioning','handover','doc_dispatch','closed']);
export function planLiveIpoBridge(ipo:LiveIpoPosition,existing:ExistingBridgeIdentity):LiveIpoBridgePlan{
 const hold=(reason:string,boardSiteIds:string[]=[]):LiveIpoBridgePlan=>({action:'hold',ipoId:ipo.ipoId,reason,boardSiteIds});
 if(!uuid.test(ipo.ipoId)||!uuid.test(ipo.operationsIssuanceId)||!ipo.ipoNumber.trim()||!ipo.siteName.trim())return hold('Exact immutable IPO and Operations handoff identity are required.');
 const links=existing.verifiedLinks.filter(l=>l.ipoId===ipo.ipoId),linkedIds=[...new Set(links.map(l=>l.boardSiteId))];
 if(linkedIds.length>1)return hold('Conflicting immutable board links require review.',linkedIds);
 if(linkedIds.length===1){if(!existing.boardSites.some(s=>s.id===linkedIds[0]))return hold('The immutable board link points to a missing site.',linkedIds);return{action:'retain',ipoId:ipo.ipoId,boardSiteId:linkedIds[0]};}
 const id=`live-ipo:${ipo.ipoId}`,prior=existing.boardSites.find(s=>s.id===id);
 if(prior){if(prior.originIpoId!==ipo.ipoId)return hold('Existing deterministic board identity does not prove this IPO.',[id]);return{action:'retain',ipoId:ipo.ipoId,boardSiteId:id};}
 if(existing.unverifiedBoardCandidateIds.length)return hold('An existing reviewed site may represent this IPO. Verify the immutable IPO/BOQ link instead of creating another site.',[...new Set(existing.unverifiedBoardCandidateIds)]);
 const w=ipo.legacy;
 if(!w.id||!knownStages.has(w.stage)||!Number.isFinite(Date.parse(w.stageEnteredAt))||!Number.isFinite(Date.parse(ipo.createdAt)))return hold('The saved site workflow position or timestamp requires review.');
 // Existing saved progress is retained; missing evidence is not reconstructed.
 const completed=w.stage==='closed'||w.stage==='doc_dispatch'||w.handedOverOn!==null||(w.scope==='delivery_only'&&w.deliveredOn!==null);
 const advanced=['installation','commissioning','handover'].includes(w.stage);
 const delivered=w.deliveredOn!==null||advanced;
 const stage=completed?'completed':delivered?'delivered':w.stage==='delivery'?'awaiting':'received';
 const type=w.scope==='delivery_only'?'delivery-only':({'Solar':'solar','BESS':'bess','Solar + BESS':'solar-bess','UPS':'ups'}as const)[w.siteType??'Solar']??null;
 const projectType=w.siteType===null&&w.scope!=='delivery_only'?null:type;
 return{action:'prepare',ipoId:ipo.ipoId,boardSiteId:id,requiresEvidence:true,site:{
 id,ipo:ipo.ipoNumber+(ipo.orderNumber?' · '+ipo.orderNumber:''),name:ipo.siteName,customerPo:ipo.customerPo,
 stage,completed,installation:w.scope===null?null:w.scope==='installation',scopePending:w.scope===null,projectType,
 operationsTeam:null,documents:[],deliveries:[],qc:{},history:[],accounts:[],
 evidencePending:completed||delivered,invoiceMilestonePending:true,stageStartedAt:w.stageEnteredAt,
 ...(w.deliveredOn?{deliveryDate:w.deliveredOn}:{}),
 origin:{kind:'live-ipo-handoff',ipoId:ipo.ipoId,operationsIssuanceId:ipo.operationsIssuanceId,legacyWorkflowId:w.id},
 legacyPosition:{stage:w.stage,installationCompletedOn:w.installationCompletedOn,handedOverOn:w.handedOverOn,closedAt:w.closedAt,expectedDelivery:w.expectedDelivery},
 reviewFlags:[...(w.scope===null?['Verify approved installation/delivery-only scope.']:[]),...(!ipo.customerPo.trim()?['Customer PO is missing; retain material-source hold.']:[]),...(projectType===null?['Verify approved project type.']:[]),'Verify invoice milestone from approved commercial terms.'],
 }};
}
