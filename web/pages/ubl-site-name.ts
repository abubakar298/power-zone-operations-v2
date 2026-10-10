/** Display name only; preserve imported evidence and customer short codes. */
export const ublSiteName=(name:string)=>name.replace(/^UBL\b[\s-]*/i,'').trim();
