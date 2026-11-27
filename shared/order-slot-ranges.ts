/** Free order slots as short text: [19,21,22,23,154] → "19, 21–23, 154". */
export function slotRanges(units:readonly number[]):string{
 const sorted=[...new Set(units)].sort((a,b)=>a-b),parts:string[]=[];
 for(let i=0;i<sorted.length;){
  let end=i;while(end+1<sorted.length&&sorted[end+1]===sorted[end]+1)end++;
  parts.push(end===i?String(sorted[i]):`${sorted[i]}–${sorted[end]}`);i=end+1;
 }
 return parts.join(', ');
}
