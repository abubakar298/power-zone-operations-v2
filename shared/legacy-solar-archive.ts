/** Owner-approved recoverable active-view archive, 29 October 2026.
 * Exact reviewed identities only. Original records, documents and balances stay intact.
 * Removing a key restores its active visibility; current Solar 70 always wins.
 */
export const archivedLegacySolarKeys = [
 "UBL:SOLAR:105",
 "UBL:SOLAR:101",
 "UBL:SOLAR:173",
 "UBL:SOLAR:170",
 "UBL:SOLAR:143",
 "UBL:SOLAR:129",
 "UBL:SOLAR:131",
 "UBL:SOLAR:144",
 "UBL:SOLAR:136",
 "UBL:SOLAR:138",
 "UBL:SOLAR:132",
 "UBL:SOLAR:130",
 "UBL:SOLAR:134",
 "UBL:SOLAR:133",
 "UBL:SOLAR:142",
 "UBL:SOLAR:137",
 "UBL:SOLAR:140",
 "UBL:SOLAR:139",
 "UBL:SOLAR:201",
 "UBL:SOLAR:149",
 "UBL:SOLAR:153",
 "UBL:SOLAR:154",
 "UBL:SOLAR:155",
 "UBL:SOLAR:178",
 "UBL:SOLAR:174",
 "UBL:SOLAR:169",
 "UBL:SOLAR:156",
 "UBL:SOLAR:224",
 "UBL:SOLAR:222",
 "UBL:SOLAR:223",
 "UBL:SOLAR:234",
 "UBL:SOLAR:247",
 "UBL:SOLAR:200",
 "UBL:SOLAR:225"
] as const;
const archived = new Set<string>(archivedLegacySolarKeys);
export function isArchivedLegacySolar(row:Record<string,any>):boolean {
 if(row.program==='Solar 70'||row.kind==='UPS')return false;
 const key=String(row.sourceKey??row.key??row.id??row.site_id??'').replace(/^registered-/,'');
 return archived.has(key);
}
export const legacySolarArchiveReason='Legacy Solar archived from active work at owner request; original history retained.';
