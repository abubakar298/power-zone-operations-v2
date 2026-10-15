/** Customer-scoped matching; master references never create or reopen workflows. */
export type HeadsupSite = {id?:string;siteId?:number;siteCode:string;siteName:string;solutionId:string;pvKw:string;scope?:string;referenceOnly?:boolean;orderStatus?:string;poNumber?:string};
export function branchKey(value:string){const text=value.trim();return /^\d+$/.test(text)?text.padStart(4,'0'):text.toLowerCase().replace(/[^a-z0-9]/g,'');}
function textSimilarity(a:string,b:string){
 if(!a||!b)return 0;let previous=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));previous=next;}
 return 1-previous[b.length]/Math.max(a.length,b.length);
}
function nameSimilarity(left:string,right:string){
 const normalize=(s:string)=>s.toLowerCase().replace(/\bubl\b|\bameen\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const a=normalize(left),b=normalize(right);if(!a||!b)return 0;
 // Shared generic words must not turn an unrelated branch into a suggested match.
 if(textSimilarity(a.split(' ')[0],b.split(' ')[0])<0.6)return 0;
 return textSimilarity(a,b);
}
export function matchHeadsupSite(row:{branchCode:string;branchName:string},selected:HeadsupSite[],existing:HeadsupSite[]){
 const missingCode=!row.branchCode.trim();
 const matching=(sites:HeadsupSite[])=>sites.filter(s=>branchKey(s.siteCode)===branchKey(row.branchCode));
 const preferred=missingCode?[]:matching(selected),found=missingCode?[...selected,...existing.filter(s=>!s.id||!selected.some(p=>p.id===s.id))]:preferred.length?preferred:matching(existing);
 const unique=new Map<string,HeadsupSite>();for(const s of found){const key=s.siteId?`site:${s.siteId}`:s.id?`record:${s.id}`:`code:${branchKey(s.siteCode)}`;const old=unique.get(key);if(!old||old.referenceOnly&&!s.referenceOnly)unique.set(key,s);}
 let candidates=[...unique.values()],similarity:number|null=null;
 if(missingCode){const ranked=candidates.map(site=>({site,score:nameSimilarity(row.branchName,site.siteName)})).sort((a,b)=>b.score-a.score);similarity=ranked[0]?.score??0;candidates=similarity>=0.6?ranked.filter(r=>Math.abs(r.score-similarity!)<0.000001).map(r=>r.site):[];}
 const candidate=candidates.length===1?candidates[0]:null;
 return {site:candidate,candidate,nameMismatch:!!candidate&&candidate.siteName.trim()!==row.branchName.trim(),codeMismatch:false,ambiguous:candidates.length>1,suggestedMatch:missingCode&&!!candidate,similarity};
}
