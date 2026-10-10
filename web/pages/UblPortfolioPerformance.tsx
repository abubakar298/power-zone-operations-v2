import {useEffect,useState} from 'react';
import {Decimal} from 'decimal.js';
import {api} from '../api.js';
import {decimalDisplay} from '../numbers.js';

type Site={status:string;baseline:{sellingExcludingGst:string;budgetedCost:string}|null};
export function UblPortfolioPerformance(){
 const [sites,setSites]=useState<Site[]|null>(null),[error,setError]=useState(''),[closed,setClosed]=useState<any[]>([]);
 useEffect(()=>{let alive=true;void Promise.all([api<{sites:Site[]}>('/ubl/sites'),api<any>('/ubl/closed-jobs')]).then(([r,c])=>{if(alive){setSites(r.sites);setClosed(c.jobs)}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[]);
 if(error)return <section><h3>Portfolio Performance</h3><p role="alert" className="form-error">Could not load portfolio performance: {error}</p></section>;
 if(!sites)return <section aria-busy="true"><h3>Portfolio Performance</h3><p role="status">Loading portfolio performance…</p></section>;
 const active=sites.filter(s=>s.status==='Active'),budgeted=active.filter(s=>s.baseline);
 const selling=budgeted.reduce((sum,s)=>sum.add(s.baseline!.sellingExcludingGst),new Decimal(0));
 const cost=budgeted.reduce((sum,s)=>sum.add(s.baseline!.budgetedCost),new Decimal(0));
 const markup=selling.sub(cost),complete=budgeted.length===active.length&&active.length>0;
 const metrics=['No. of sites','Total Value','Total Cost','Markup','Markup %'];
 const values=[String(active.length),complete?decimalDisplay(selling.toString(),0):'—',complete?decimalDisplay(cost.toString(),0):'—',complete?decimalDisplay(markup.toString(),0):'—',complete&&cost.gt(0)?`${decimalDisplay(markup.div(cost).mul(100).toString(),0)}%`:'—'];
 const actualSelling=closed.reduce((n,j)=>n.add(j.sellingValue),new Decimal(0)),actualCost=closed.reduce((n,j)=>n.add(j.actualCost),new Decimal(0)),actualMarkup=actualSelling.sub(actualCost);
 const actualValues=[String(closed.length),closed.length?decimalDisplay(actualSelling.toString(),0):'—',closed.length?decimalDisplay(actualCost.toString(),0):'—',closed.length?decimalDisplay(actualMarkup.toString(),0):'—',actualCost.gt(0)?decimalDisplay(actualMarkup.div(actualCost).mul(100).toString(),0)+'%':'—'];
 return <section className="ubl-performance" aria-labelledby="ubl-performance-heading"><h3 id="ubl-performance-heading">Portfolio Performance</h3><p className="pz-caption">{sites.length} registered sites · {active.length} active · {sites.filter(s=>s.status==='Cancelled').length} cancelled · {sites.filter(s=>s.status==='Awaiting revised PO').length} awaiting revised PO<br/>PKR · Financial values exclude GST</p>
 <div className="ubl-performance-columns">{['Budgeted','Actual'].map((heading,column)=><article key={heading} className={`ubl-performance-card${column?' ubl-performance-actual':''}`} aria-label={column?'Actual approved closed jobs':'Budgeted active sites'}><header><h4>{heading}</h4><span className="pz-caption">{column?'Approved closed jobs':'Active sites · saved baselines'}</span></header><dl>{metrics.map((label,i)=><div key={label} className={i>=3?'ubl-performance-profit':''}><dt>{label}</dt><dd>{column?actualValues[i]:values[i]}{i===0&&<small> {column?'closed':'sites'}</small>}</dd></div>)}</dl></article>)}</div>
 {!complete&&<p role="status" className="pz-caption">Complete budget totals await confirmed baselines for every active site.</p>}<p className="pz-caption">Actual results include only Management-approved job closures. Pending closure drafts are excluded.</p></section>;
}
