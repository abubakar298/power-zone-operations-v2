// Conservative evidence extraction: never infer blank handwriting or substitute a dispatch quantity.
export function parseUsageSignoff(text,{reference,ipo,rows}) {
 const matches=[],issues=[];
 const clean=String(text||'').replace(/\u00a0/g,' ');
 const hasReference=value=>{const at=clean.indexOf(value);return at>=0&&!/[A-Za-z0-9]/.test(clean[at-1]||'')&&!/[A-Za-z0-9]/.test(clean[at+value.length]||'');};
 if(!hasReference(reference)||!hasReference(ipo))return{matches,issues:['Parent DO reference or site IPO does not match this upload.']};
 if(/Issued\s+(?:to site|Qty)|Returned\s+Qty/i.test(clean))return{matches,issues:['Upload this site’s Used Qty-only parent sign-off, not the warehouse DO.']};
 const lines=clean.split(/\r?\n/);
 const byId=new Map();for(const row of rows){const list=byId.get(row.id)||[];list.push(row);byId.set(row.id,list);}
 for(const [id,candidates] of byId){
  const seen=[];
  for(let i=0;i<lines.length;i++){
   const at=lines[i].indexOf(id);if(at<0||/[A-Za-z0-9/-]/.test(lines[i][at+id.length]||''))continue;
   const tail=lines[i].slice(at+id.length).trim();
   const reading=tail.match(/^(?:(m|mtr|metre|meter|ft|feet|pair|piece|packet|nos)\.?\s*[|:]?\s*)?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*$/i);
   if(!reading)continue;
   const unit=reading[1]?.toLowerCase();
   let applicable=candidates;
   if(applicable.length>1){const context=(lines[i-1]||'')+' '+lines[i];applicable=candidates.filter(r=>context.toLowerCase().includes(r.description.toLowerCase()));}
   if(applicable.length!==1){issues.push(`${id}: variant could not be matched uniquely.`);continue;}
   const row=applicable[0];const normalize=u=>({mtr:'m',metre:'m',meter:'m',feet:'ft',nos:'piece'}[u]||u);
   if(unit&&normalize(unit)!==normalize(row.unit.toLowerCase())){issues.push(`${id}: source unit differs from dispatch; quantity not applied.`);continue;}
   const used=Number(reading[2].replaceAll(',',''));if(!Number.isFinite(used)||used<0)continue;
   seen.push({key:row.key,used});
  }
  const keys=new Set(seen.map(r=>r.key));
  for(const key of keys){const values=seen.filter(r=>r.key===key);if(values.length!==1){issues.push(`${id}: repeated quantity lines require a corrected document.`);continue;}matches.push(values[0]);}
 }
 for(const row of rows)if(!matches.some(m=>m.key===row.key))issues.push(`${row.description}: Used Qty unreadable, blank or missing; no quantity inferred.`);
 return{matches,issues:[...new Set(issues)]};
}

export function applyUsageSignoff(dispatch,{site,evidence,matches}){
 if(dispatch.reconciliationStatus==='complete')throw Error('This Parent DO is closed.');
 if(!dispatch.sites.includes(site))throw Error('Site is not on this Parent DO.');
 if((dispatch.signoffEvidence||[]).some(e=>e.hash===evidence.hash))throw Error('This document is already recorded.');
 if(!matches.length)throw Error('No readable usage quantities to apply.');
 const allowed=new Set(dispatch.rows.filter(r=>!r.applicableSites?.length||r.applicableSites.includes(site)).map(r=>r.key));
 if(matches.some(m=>!allowed.has(m.key)||!Number.isFinite(Number(m.used))||Number(m.used)<0))throw Error('Usage does not match this site’s dispatch rows.');
 // A revision is a new complete site snapshot, never a mixture of old and new quantities.
 const allocations={};for(const m of matches)allocations[m.key]={used:String(m.used),returned:'',evidenceHash:evidence.hash};
 return {...dispatch,allocations:{...dispatch.allocations,[site]:allocations},signoffEvidence:[...(dispatch.signoffEvidence||[]).map(e=>e.site===site?{...e,status:'superseded'}:e),{...evidence,status:'active'}],reconciliationStatus:dispatch.reconciliationStatus==='management-review'?'management-review':'waiting'};
}
