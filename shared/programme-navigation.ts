export type ProgrammeNavigation={programme:string;bucket:string;search:string};
const buckets=new Set(['active','installed','pendingDelivery','partialDelivery','installationPending','invoicePending','paymentPending',...['advance','completion'].flatMap(phase=>['submitted','received','pending','toSubmit','future'].map(key=>phase+':'+key))]);
export function programmeNavigation(hash:string,programmes:readonly string[]):ProgrammeNavigation{
 const params=new URLSearchParams(hash.replace(/^#/,'')),programme=params.get('programme')??'',bucket=params.get('programmeBucket')??'';
 return{programme:programmes.includes(programme)?programme:'ubl-ups-250',bucket:buckets.has(bucket)?bucket:'active',search:(params.get('programmeSearch')??'').slice(0,200)};
}
/** Replace filters, preserve unrelated workspace/deep-link fields, and never push one history entry per keystroke. */
export function programmeNavigationHash(hash:string,value:ProgrammeNavigation):string{
 const params=new URLSearchParams(hash.replace(/^#/,''));params.set('workspace',params.get('workspace')==='finance'?'finance':'dashboard');params.set('programme',value.programme);
 if(value.bucket==='active')params.delete('programmeBucket');else params.set('programmeBucket',value.bucket);
 if(value.search)params.set('programmeSearch',value.search.slice(0,200));else params.delete('programmeSearch');
 return '#'+params.toString();
}
