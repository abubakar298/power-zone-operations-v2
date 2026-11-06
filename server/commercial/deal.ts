import {Decimal} from "decimal.js";
export const CASH_PROFIT_NOTE = "Cash deal: the GST-equivalent amount is retained in the selling price and increases markup; it is not recorded as GST payable.";
export function cashDeal(v:any){return v?.saleType === "Cash Deal";}
export function retainedGst(v:any){return cashDeal(v) && v.cashGstTreatment === "Included in selling price";}
export function sellingFactor(v:any,rate:string){return retainedGst(v)?new Decimal(rate).div(100).add(1):new Decimal(1);}
