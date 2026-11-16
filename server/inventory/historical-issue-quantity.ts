import {Decimal} from 'decimal.js';

type IssueEvent = {
  kind:string;
  documentType:string;
  quantity:string;
  sourceIds:string[];
  duplicateSourceRows:number;
};
const issueRowId=/^(DO-ISSUE:.+):(?:source-row-|row)?(\d+):0$/;

export function historicalIssueQuantity(event:IssueEvent):string {
  const {quantity,sourceIds}=event;
  if(event.kind!=='issue'||event.documentType!=='DO'||sourceIds.length<2||
    sourceIds.length!==event.duplicateSourceRows)return quantity;

  // The import stores the per-row quantity and groups otherwise identical
  // rows. Count distinct row numbers only if they come from one DO source.
  const first=issueRowId.exec(sourceIds[0]!);
  if(!first)return quantity;
  const rowNumbers=new Set<number>();
  for(const id of sourceIds){
    const row=issueRowId.exec(id);
    if(!row||row[1]!==first[1])return quantity;
    rowNumbers.add(Number(row[2]));
  }
  if(rowNumbers.size!==sourceIds.length)return quantity;
  return new Decimal(quantity).times(rowNumbers.size).toString();
}
