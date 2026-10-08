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
  return lines.flatMap((line,index) => members[index].map((item,memberIndex) => ({
    ...item, group:line.group,
    ...(memberIndex === 0 && line.amount !== undefined ? {
      amount:line.amount,
      span:members.slice(index,index + (line.span ?? 1)).reduce((sum,rows)=>sum+rows.length,0),
    } : {}),
  })));
}
