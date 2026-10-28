/** Current closure state takes precedence over a prior PT receipt. Unknown
 * states remain outside preparation; they must not reopen submitted/closed work. */
export function isClosurePreparationJob(input:{latestClosure:{stage?:unknown}|null|undefined;ptRecorded:boolean}):boolean{
 if(input.latestClosure==null)return input.ptRecorded;
 return input.latestClosure.stage==='Draft'||input.latestClosure.stage==='Returned for Revision';
}
