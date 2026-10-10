import {displayUnit} from '../boq/unit.js';
import {Decimal} from 'decimal.js';
import type { QuoteLine } from './engine.js';

/** Expand customer scope without changing the stored financial groups or amounts. */
export function quotationDisplayRows(lines: QuoteLine[]): QuoteLine[] {
  const members = lines.map(line => {
    if (line.items?.length) return line.items;
    // Older saved BESS quotations used one multiline LS cell. Read it without rewriting history.
    const parts = line.description.split('\n');
    const parsed = parts.map(description => description.match(/^(.*?)\s+\((\d+(?:\.\d+)?)\s+([^()]+)\)$/));
    if (line.unit === 'LS' && parts.length > 1 && parsed.every(Boolean))
      return parsed.map(match => ({description:match![1], qty:match![2], unit:match![3]}));
    return [{description:line.description,unit:line.unit,qty:line.qty}];
  });
  return lines.flatMap((line,index) => {
    if(line.items?.length && line.amount!==undefined && line.items.every(i=>i.amount!==undefined)){
      const items=line.items.map(i=>({...i}));
      const delta=new Decimal(line.amount).sub(items.reduce((v,i)=>v.add(i.amount!),new Decimal(0))).mul(100).toDecimalPlaces(0);
      // A displayed introductory offer increase is allocated by its saved allowance,
      // using integer cents. It never changes the frozen net price or tax calculation.
      const allowance=items.map(i=>new Decimal(i.offerAllowance??"0"));
      const weights=allowance.some(w=>w.gt(0))?allowance:items.map(i=>new Decimal(i.amount!));
      const sum=weights.reduce((v,w)=>v.add(w),new Decimal(0));
      if(!delta.isZero() && sum.gt(0)){
        const exact=weights.map(w=>delta.abs().mul(w).div(sum));
        const cents=exact.map(v=>v.floor());
        let remaining=delta.abs().sub(cents.reduce((v,w)=>v.add(w),new Decimal(0))).toNumber();
        const order=exact.map((v,i)=>({i,fraction:v.sub(cents[i])})).sort((a,b)=>b.fraction.comparedTo(a.fraction)||a.i-b.i);
        for(const {i} of order){if(remaining--<=0)break;cents[i]=cents[i].add(1);}
        items.forEach((item,i)=>item.amount=new Decimal(item.amount!).add(cents[i].mul(delta.isNegative()?-1:1).div(100)).toFixed(2));
      }else if(!delta.isZero())items.at(-1)!.amount=new Decimal(items.at(-1)!.amount!).add(delta.div(100)).toFixed(2);
      return items.map(item=>({...item,group:line.group,span:1}));
    }
    return members[index].map((item,memberIndex) => ({
    ...item, group:line.group,
    ...(memberIndex === 0 && line.amount !== undefined ? {
      amount:line.amount,
      span:members.slice(index,index + (line.span ?? 1)).reduce((sum,rows)=>sum+rows.length,0),
    } : {}),
  }));
  }).map(row=>{
    const job=/^(Installation, Testing|UPS installation|Single-phase installation|Project delivery)/i.test(row.description);
    return {...row,unit:job?"JOB":displayUnit(row.unit,row.qty),qty:job?"1":row.qty};
  });
}
