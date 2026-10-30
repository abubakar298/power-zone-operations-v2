import {OperationsBoardRepository} from '../server/operations-board/repository.js';
import {workflowSiteSchema} from '../server/operations-board/workflow.js';

// Repository reads expose the base imported site shape. Validate the extended
// workflow snapshot before tests inspect planning, delivery or QC fields.
export function workflowSnapshot(value:{version:number}){
 return {...workflowSiteSchema.parse(value),version:value.version};
}
export async function readWorkflowSite(repo:OperationsBoardRepository,actor:string,id:string){
 return workflowSnapshot(await repo.site(actor,id));
}
