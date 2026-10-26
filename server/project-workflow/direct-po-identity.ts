export function directPoIdentity(text:string){
 const codes=[...new Set([...text.matchAll(/branch\s+(?:code|id|no\.?)\s*[:#-]?\s*([A-Za-z0-9_-]{1,30})/gi)].map(m=>m[1]).filter(code=>/\d/.test(code)))];
 if(codes.length!==1)throw Error(codes.length?'The PO contains more than one branch code. Upload a PO for one branch.':'Branch code could not be read. Upload a clearer PO.');
 const code=/^\d{1,4}$/.test(codes[0])?codes[0].padStart(4,'0'):codes[0];
 const names=[...new Set([...text.matchAll(/branch\s+name\s*[:#-]?\s*([^\r\n]+)/gi)].map(m=>m[1].trim()).filter(Boolean))];
 return {code,sourceCode:codes[0],name:names.length===1?names[0]:undefined};
}
