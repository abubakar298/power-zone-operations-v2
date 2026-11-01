import {HttpError} from '../http/errors.js';
import {siteBucket,today,type WorkflowSite,type FileReference} from './workflow.js';

/** Later uploads support an existing recorded position; they never re-complete
 * a job, move its dates, or regenerate an invoicing milestone. */
export function attachHistoricalEvidence(site:WorkflowSite,value:{category:'delivery'|'handover';date:string;files:FileReference[];completionEvidenceVersion?:number;acknowledgement?:FileReference;irr?:FileReference;variableSignoff?:FileReference;noVariableItemsUsed?:boolean},now:string,editing:boolean):WorkflowSite{
 if(value.date>today(now))throw new HttpError(422,'The document date cannot be in the future.');
 if(value.category==='delivery'&&!['delivered','completed'].includes(siteBucket(site)))throw new HttpError(409,'Record delivery before attaching historical delivery evidence.');
 if(value.category==='handover'&&(site.installation!==true||siteBucket(site)!=='completed'))throw new HttpError(409,'Handover evidence applies to an installation already recorded complete.');
 if(site.deliveries?.length&&value.category==='delivery'||value.category==='handover'&&(site.qcJob||site.qc?.signoff||site.qc?.handover))throw new HttpError(409,'Use Edit on the existing delivery or QC record to correct its evidence.');
 const id=`${site.id}:historical-${value.category}-documents`,old=site.documents?.find(d=>d.id===id);
 if(old&&!editing)throw new HttpError(409,'The saved evidence is locked. Use Edit and give a reason.');
 if(editing&&!old)throw new HttpError(409,'There is no saved historical evidence to edit.');
 if(old&&(old.evidenceDate??old.createdDate??old.date)===value.date&&JSON.stringify(old.evidence.map(f=>f.id))===JSON.stringify(value.files.map(f=>f.id)))throw new HttpError(422,'No document evidence changed.');
 const typed=value.completionEvidenceVersion===2?{completionEvidenceVersion:2,acknowledgement:value.acknowledgement,irr:value.irr,variableSignoff:value.variableSignoff,noVariableItemsUsed:value.noVariableItemsUsed===true}:{};
 const document=old?{...old,...typed,evidence:value.files,evidenceDate:value.date}:{id,...typed,evidenceDate:value.date,label:value.category==='delivery'?'Delivery DO · existing delivery':'Handover · existing completed installation',location:site.documentsSubmittedToAccounts===true?'Submitted to Accounts' as const:'Location not recorded' as const,date:value.date,createdDate:value.date,createdAt:now,evidence:value.files,history:[]};
 return {...site,documents:[...(site.documents??[]).filter(d=>d.id!==id),document],history:[...site.history,{date:now,description:`${editing?'Corrected':'Attached'} ${value.category} evidence for the existing site record.`}]};
}
