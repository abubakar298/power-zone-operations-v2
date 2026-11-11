import assert from 'node:assert/strict';
import type {ProjectWorkflowRepository} from '../server/project-workflow/repository.js';

// preparation_minutes on legacy tasks is a live timer (time spent so far), so
// two lists taken a moment apart differ there; compare only whether it is set.
const stable=(list:any)=>({...list,legacyTasks:(list.legacyTasks??[]).map((t:any)=>({...t,preparation_minutes:t.preparation_minutes===null?null:typeof t.preparation_minutes}))});

// The fast (batched) department list must be identical to the original
// record-by-record list. Returns the batched list for further assertions.
export async function assertBatchedListMatchesDirect(repo:ProjectWorkflowRepository,actor:string,department:string,scope:string){
  const batched=await repo.list(actor,department,scope);
  const direct=await repo.list(actor,department,scope,'direct');
  assert.deepEqual(stable(batched),stable(direct),`batched ${department}/${scope} list differs from the record-by-record list`);
  return batched;
}
