/** Both plain and comma-grouped amounts remain searchable without changing stored values. */
export function documentListSearch(record:any){
 const amount=record.documentAmount??'';
 return [record.solutionType,amount,String(amount).replace(/\B(?=(\d{3})+(?!\d))/g,',')].filter(Boolean).join(' ');
}
