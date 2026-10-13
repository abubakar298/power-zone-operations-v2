import {decimalDisplay} from "../numbers.js";
/** Display only; financial calculations remain on the existing Decimal engine. */
export function FinancialValue({value,places=2}:{value:string|number|null|undefined;places?:number}) {
 return <span className="pz-numeric">{decimalDisplay(value,places)}</span>;
}
