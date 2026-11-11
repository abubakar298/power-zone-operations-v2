import {Decimal} from 'decimal.js';

// Once DOs exist for a project, each quantity box is "send now": only what goes on the next DO.
// The saved row keeps the running total (already sent + send now), so earlier DOs and the
// server's checks stay as they are.
const numeric=/^\d+(?:\.\d+)?$/;
const nothingSent=(sent:string|undefined)=>!sent||!numeric.test(sent)||new Decimal(sent).isZero();

/** The box value: total minus what earlier DOs sent (blank when nothing is left). */
export function sendNowQuantity(out:string,sent:string|undefined){
 if(nothingSent(sent))return out;
 if(!out)return '';
 if(!numeric.test(out))return out;
 const left=new Decimal(out).minus(sent!);
 return left.gt(0)?left.toString():'';
}

/** The saved total from what was typed: already sent + send now. Odd typing is kept for the usual checks to report. */
export function totalFromSendNow(entered:string,sent:string|undefined){
 if(nothingSent(sent))return entered;
 const value=entered.trim();
 if(!value)return sent!;
 if(!numeric.test(value))return entered;
 return new Decimal(sent!).plus(value).toString();
}
