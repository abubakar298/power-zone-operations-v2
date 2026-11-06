export function workflowFeedback(path:string,payload:any){
 let message='';
 if(/\/headsup-receipts\/[^/]+\/send$/.test(path)){window.dispatchEvent(new CustomEvent('pz:workflow-completed',{detail:{message:'Report sent to Management. Advance BOQ sent to Operations.'}}));return;}
 if(path==='/project-workflow/headsup-receipts')message='Heads-up saved. Summary ready for review.';
 else if(path==='/coordinator/events'&&payload.kind==='Submitted')message='Sent to Management.';
 else if(path==='/coordinator/events'&&payload.kind==='Approved')message='Approved. Ready for the next stage.';
 else if(path==='/coordinator/events'&&payload.kind==='Changes requested')message='Returned for revision.';
 else if(/\/project-workflow\/[^/]+\/actions$/.test(path)){
  if(payload.action==='save-survey-completion'&&payload.input?.completeSubmission)message='Sent for technical review.';
  else if(['send-design','submit-technical-review','handoff','dispatch','advance','receipt','resolve','report','technical-return','commercial-return'].includes(payload.action))message='Sent successfully to the next stage.';
 }else if(path==='/project-workflow/ubl-survey-packages'&&payload.submit)message='Report and Excel sent to Management.';
 else if(/\/(send|submit|handoff|dispatch|issue|approve)$/.test(path))message='Sent successfully to the next stage.';
 if(message)window.dispatchEvent(new CustomEvent('pz:workflow-completed',{detail:{message}}));
}
