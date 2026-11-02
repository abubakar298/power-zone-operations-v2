import {quotationDisplayRows} from '../../server/commercial/quotation-rows.js';
import {orderCustomerScopeLines} from '../../server/commercial/customer-scope.js';
import type {QuotationSnapshot} from '../../server/commercial/engine.js';
import {money} from '../numbers.js';
import './quotation-fallback.css';
/** Read-only customer quotation content, using the same rows and selling footer as
 * the PDF. No internal BOQ costs or markup fields are selected for this view. */
export function QuotationFallback({snapshot:s,number}:{snapshot:QuotationSnapshot;number?:string}){
 const scope='customerScopeVersion' in s&&s.customerScopeVersion===1?orderCustomerScopeLines(s.lines,s.presentation):s.lines;
 const rows=quotationDisplayRows(scope),amounts=s.presentation!=='No Breakup';
 return <article className="quotation-browser-fallback" aria-label="Quotation content preview">
  <header><img src="/brand/power-zone-white.png" alt="Power Zone"/><strong>{number??'Quotation preview'}</strong></header>
  <div className="quotation-browser-identity"><div><strong>{s.customer.name}</strong><p>{s.siteName} · {s.siteCode}</p></div><div><strong>{s.input.quotedDate}</strong><p>Validity: {s.input.validity}</p></div></div>
  <h3>{s.subject}</h3><div className="pz-table-scroll"><table><thead><tr><th>SR#</th><th>Product / Service Description</th><th>UOM</th><th>Qty</th>{amounts&&<th className="numeric">Amount</th>}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{i+1}</td><td>{r.description}</td><td>{r.unit}</td><td className="numeric">{new Intl.NumberFormat('en-PK',{maximumFractionDigits:4}).format(Number(r.qty))}</td>{amounts&&r.amount!==undefined&&<td className="numeric" rowSpan={r.span??1}>{money(r.amount)}</td>}</tr>)}</tbody></table></div>
  <dl>{s.footer.map((r,i)=><div key={i}><dt>{r.label}</dt><dd>{money(r.amount)}</dd></div>)}</dl>
  {!!s.notes.length&&<section><h4>Notes</h4><ol>{s.notes.map((n,i)=><li key={i}>{n}</li>)}</ol></section>}
  <section><h4>Terms and conditions</h4><ol>{s.terms.map((t,i)=><li key={i}>{t}</li>)}</ol></section>
 </article>;
}
