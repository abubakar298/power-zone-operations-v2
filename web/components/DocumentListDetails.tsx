import {money} from '../numbers.js';
/** Saved payable and solution family, shared by each Coordinator document bucket. */
export function DocumentListDetails({record}:{record:any}){
 return <div className="pz-caption"><span>{record.solutionType??'Not recorded'}</span><span> · {record.documentAmount!=null?`PKR ${money(record.documentAmount)}`:'Amount not available'}</span></div>;
}
