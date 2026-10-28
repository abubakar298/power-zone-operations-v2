/** Display only: official saved identifiers and historical references are unchanged. */
export function printedReference(reference:string):string{
 const match=/^CPZ-(QT|BOQ|PBQ)-(\d{2})-(\d{3,})-\d{4,}-\d{3,}(-R[1-9]\d*)?( \([^\r\n]*\))?$/.exec(reference);
 return match?`${match[1]}-${match[2]}-${match[3]}${match[4]??''}`:reference;
}
