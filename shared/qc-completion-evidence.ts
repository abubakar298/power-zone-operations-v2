/** Typed references for new handovers; retain the historical three-file order only for old records. */
export function completionEvidence(document:any){
 if(document?.completionEvidenceVersion===2)return {acknowledgement:document.acknowledgement,irr:document.irr,variableSignoff:document.variableSignoff,noVariableItemsUsed:document.noVariableItemsUsed===true};
 return {acknowledgement:document?.evidence?.[0],irr:document?.evidence?.[1],variableSignoff:document?.evidence?.[2],noVariableItemsUsed:false};
}
