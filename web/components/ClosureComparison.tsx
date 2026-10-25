import {Decimal} from 'decimal.js';
import {money} from '../numbers.js';
import {markupPercent} from './ClosurePerformance.js';
import {closurePhases} from '../../server/accounts/phase-comparison.js';

export function ClosureComparison({job,actual,epcAggregate}:{job:any;actual:Record<string,string>;epcAggregate:string}){
 const costs:Record<string,string>={...actual,EPC:epcAggregate};
 const valid=(v:any)=>v!==null&&v!==undefined&&v!=='';
 const sum=(values:any[])=>values.every(valid)?values.reduce((s,v)=>s.add(v),new Decimal(0)).toString():null;
 const budgetTotal=sum(closurePhases.map(p=>job.budget[p]));
 const actualTotal=sum(closurePhases.map(p=>costs[p]));
 const markup=(selling:any,cost:any)=>valid(selling)&&valid(cost)?new Decimal(selling).sub(cost).toString():null;
 const cash=(v:any)=>valid(v)?money(v):'Not available';
 const row=(name:string,actualCard:boolean)=>{
  const selling=name==='Total'?job.selling:job.phaseSelling?.[name];
  const cost=name==='Total'?(actualCard?actualTotal:budgetTotal):(actualCard?costs[name]:job.budget[name]);
  const peer=name==='Total'?job.phaseCostComparison?.total:job.phaseCostComparison?.phases?.[name];
  return <tr key={name}><th scope="row">{name}</th><td className="pz-number">{cash(selling)}</td><td className="pz-number">{cash(cost)}</td><td className="pz-number">{cash(markup(selling,cost))}<br/><span className="pz-caption">{valid(cost)?markupPercent(selling,cost):'Not entered'}</span></td>{actualCard&&<td className="pz-number">{cash(peer?.averageActualCost)}<br/><span className="pz-caption">{peer?.jobs?`${peer.jobs} closed ${peer.jobs===1?'job':'jobs'}`:'No comparable closed costs'}</span></td>}</tr>;
 };
 return <section className="pz-stack pz-closure-comparison" aria-label="Budget and actual closure comparison">
  <p className="pz-caption">PKR · excluding GST · Markup = selling price − cost; percentage is markup on cost. {job.history?.[0]?.stage==='Awaiting Management'?'Submitted figures are the saved Accounts version awaiting your decision.':job.history?.[0]?.stage==='Closed'?'Figures are the approved closed-job version.':'Draft costs are not yet submitted for approval.'}</p>
  <div className="pz-form-grid pz-closure-cards">
   {[false,true].map(isActual=><section key={String(isActual)} className="pz-panel pz-stack" aria-label={isActual?'Actual job performance':'Budgeted job performance'}>
    <h3>{isActual?'Actual':'Budgeted'}</h3>
    <dl className="project-facts"><div><dt>Selling price · excl. GST</dt><dd>{cash(job.selling)}</dd></div><div><dt>{isActual?'Actual cost':'Budgeted cost'}</dt><dd>{cash(isActual?actualTotal:budgetTotal)}</dd></div><div><dt>{isActual?'Actual markup earned':'Budgeted markup'}</dt><dd>{cash(markup(job.selling,isActual?actualTotal:budgetTotal))} · {markupPercent(job.selling,isActual?actualTotal:budgetTotal)}</dd></div></dl>
    <div className="pz-table-scroll"><table className="master-table"><thead><tr><th>Phase</th><th>Selling price</th><th>{isActual?'Actual cost':'Budgeted cost'}</th><th>Markup / %</th>{isActual&&<th>Average actual cost</th>}</tr></thead><tbody>{closurePhases.map(p=>row(p,isActual))}</tbody><tfoot>{row('Total',isActual)}</tfoot></table></div>
   </section>)}
  </div>
  <p className="pz-caption">Average actual cost uses other Management-approved closed jobs for the same customer and configuration ({job.identity?.configuration_id||'configuration not recorded'}), excluding this job. Each phase shows its own sample count; missing costs are excluded. Drafts and jobs awaiting approval are excluded.</p>
 </section>;
}
