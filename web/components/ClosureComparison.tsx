import {Decimal} from 'decimal.js';
import {money} from '../numbers.js';
import {markupPercent} from './ClosurePerformance.js';
import {closurePhases,closureEpcSelling} from '../../server/accounts/phase-comparison.js';

const epcNames=['Electrical Labour','Earthing Cost','Deliveries','Installation Cost'];
export function ClosureComparison({job,actual,epcAggregate,epc}:{job:any;actual:Record<string,string>;epcAggregate:string;epc?:Record<string,string>}){
 const costs:Record<string,string>={...actual,EPC:epcAggregate};
 const epcSelling=closureEpcSelling(job.phaseSelling?.EPC,job.epcBudget,job.budget?.EPC,job.epcSelling);
 const epcActual=epc??job.input?.epc??job.history?.[0]?.snapshot.input?.epc??{};
 const valid=(v:any)=>v!==null&&v!==undefined&&v!=='';
 const sum=(values:any[])=>values.every(valid)?values.reduce((s,v)=>s.add(v),new Decimal(0)).toString():null;
 const budgetTotal=sum(closurePhases.map(p=>job.budget[p])),actualTotal=sum(closurePhases.map(p=>costs[p]));
 const difference=(budget:any,cost:any)=>valid(budget)&&valid(cost)?new Decimal(cost).sub(budget).toString():null;
 const markup=(selling:any,cost:any)=>valid(selling)&&valid(cost)?new Decimal(selling).sub(cost).toString():null;
 const cash=(v:any,missing='Not available')=>valid(v)?money(v):missing;
 const markupCell=(selling:any,cost:any)=><td className="pz-number"><span className="pz-closure-primary">{cash(markup(selling,cost),'Not entered')}</span><small>{valid(selling)&&valid(cost)?markupPercent(selling,cost,0):'—'}</small></td>;
 const averageCell=(peer:any)=><td className="pz-number"><span className="pz-closure-primary">{cash(peer?.averageActualMarkup,'Not recorded')}</span><small>{valid(peer?.averageActualMarkupPercent)?new Decimal(peer.averageActualMarkupPercent).toDecimalPlaces(2).toString()+'%':'Not recorded'}</small>{peer?.markupJobs>0&&<small>{peer.markupJobs} closed {peer.markupJobs===1?'job':'jobs'}</small>}</td>;
 const row=(name:string)=>{
  const total=name==='Total',selling=total?job.selling:job.phaseSelling?.[name],budget=total?budgetTotal:job.budget[name],cost=total?actualTotal:costs[name];
  const peer=total?job.phaseCostComparison?.total:job.phaseCostComparison?.phases?.[name];
  return <tr key={name}><th scope="row">{name}</th><td className="pz-number">{cash(selling)}</td><td className="pz-number">{cash(budget)}</td><td className="pz-number">{cash(cost,'Not entered')}</td><td className="pz-number">{cash(difference(budget,cost),'Not entered')}</td>{markupCell(selling,budget)}{markupCell(selling,cost)}{averageCell(peer)}</tr>;
 };
 return <section className="pz-panel pz-stack pz-closure-comparison" aria-label="Job cost comparison">
  <h3>Job cost comparison</h3>
  <dl className="pz-closure-summary"><div><dt>Selling · excl. GST</dt><dd>{cash(job.selling)}</dd></div><div><dt>Budgeted cost</dt><dd>{cash(budgetTotal)}</dd></div><div><dt>Actual cost</dt><dd>{cash(actualTotal,'Not entered')}</dd></div><div><dt>Cost difference</dt><dd>{cash(difference(budgetTotal,actualTotal),'Not entered')}</dd></div></dl>
  <p className="pz-caption">PKR · excluding GST. Cost difference = actual − budget; a positive amount is over budget. Markup percentages are on cost. {job.history?.[0]?.stage==='Awaiting Management'?'Saved Accounts version awaiting your decision.':job.history?.[0]?.stage==='Closed'?'Approved closed-job figures.':'Draft costs are not yet submitted for approval.'}</p>
  <div className="pz-table-scroll"><table className="master-table pz-closure-comparison-table"><thead><tr><th>Phase / EPC item</th><th>Selling price</th><th>Budgeted cost</th><th>Actual cost</th><th>Cost difference</th><th>Budgeted markup</th><th>Actual markup</th><th>Average markup</th></tr></thead><tbody>{closurePhases.flatMap(p=>p==='EPC'?[row(p),...epcNames.map(name=><tr key={'epc-'+name} className="pz-closure-epc-row"><th scope="row"><span>{name}</span><small>EPC breakup</small></th><td className="pz-number">{cash(epcSelling?.[name])}</td><td className="pz-number">{cash(job.epcBudget?.[name])}</td><td className="pz-number">{cash(epcActual[name],'Not entered')}</td><td className="pz-number">{cash(difference(job.epcBudget?.[name],epcActual[name]),'Not entered')}</td>{markupCell(epcSelling?.[name],job.epcBudget?.[name])}{markupCell(epcSelling?.[name],epcActual[name])}{averageCell(job.phaseCostComparison?.epc?.[name])}</tr>)]:[row(p)])}</tbody><tfoot>{row('Total')}</tfoot></table></div>
  <p className="pz-caption">EPC breakup rows are included in the EPC total, not added again. EPC selling and markup are allocated in proportion to saved budgeted costs; approved totals stay unchanged. Average markup uses other Management-approved jobs for the same customer and configuration ({job.identity?.configuration_id||'configuration not recorded'}), excluding this job. The amount is the mean markup per job; percentage is total peer markup divided by total peer actual cost. Missing selling or costs are excluded.</p>
 </section>;
}
