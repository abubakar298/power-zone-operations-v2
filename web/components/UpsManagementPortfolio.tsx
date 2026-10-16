import {UpsActiveSites} from './UpsActiveSites.js';
import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {wholeMoney as money,decimalDisplay} from '../numbers.js';
import {Decimal} from 'decimal.js';
import {Button} from '../ui/Button.js';
import {Icon} from './Icon.js';
import {DocumentPreview} from './DocumentPreview.js';

export function UpsManagementPortfolio({customer}:{customer:'MBL'|'UBL'}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState<string>(),[loading,setLoading]=useState(false);
 async function load(){setLoading(true);try{setData(await api(`/director/ups?customer=${customer}`));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{setData(undefined);setSelected(undefined);void load();const refresh=()=>void load();window.addEventListener('focus',refresh);const timer=setInterval(refresh,30000);return()=>{window.removeEventListener('focus',refresh);clearInterval(timer);};},[customer]);
 const rows=(data?.rows??[]).filter((r:any)=>[r.number,r.site,r.siteCode,r.configuration,r.orderNumber,r.payable].join(' ').toLowerCase().includes(search.toLowerCase()));
 const current=data?.rows.find((r:any)=>r.id===selected);
 const hasMasterImport=Boolean(data?.register?.programs.length),budgetedSites=hasMasterImport?data.register.activeSites:data?.totals.orders??0;
 return <section className="pz-stack" aria-label={`${customer} UPS confirmed orders`}>
  {data?.register&&<UpsActiveSites key={customer} register={data.register} onPreview={setSelected} prices={data.budgeted?.options}>
  {data&&<section className="ubl-performance" aria-labelledby="ups-performance-heading">
   <h3 id="ups-performance-heading">Portfolio Performance</h3>
   <p className="pz-caption pz-ups-note">{hasMasterImport?`${budgetedSites} active sites · imported orders included`:data.program?`${data.program.totalSites} sites ordered · ${data.totals.orders} IPO received · ${Math.max(0,data.program.totalSites-data.totals.orders)} pending`: `${data.totals.orders} ${data.totals.orders===1?'IPO':'IPOs'} received`} · {data.actual.sites} financial closures recorded<br/>PKR · Financial values exclude GST</p>
   <div className="ubl-performance-columns">{['Budgeted','Actual'].map((title,column)=>{
    const budget=data.budgeted,cost=new Decimal(budget?.cost??data.totals.budgetedCost),profit=new Decimal(budget?.profit??data.totals.budgetedProfit);
    const values=column?[String(data.actual.sites),data.actual.sellingExGst?money(data.actual.sellingExGst):'—',data.actual.cost?money(data.actual.cost):'—',data.actual.markup?money(data.actual.markup):'—',data.actual.markupPercent===null?'—':`${decimalDisplay(data.actual.markupPercent,0)}%`]:[String(budgetedSites),money(budget?.sellingExGst??data.totals.sellingExGst),money(cost.toString()),money(profit.toString()),cost.gt(0)?`${decimalDisplay(profit.div(cost).mul(100).toString(),0)}%`:'—'];
    if(column&&data.actual.costPending)values.fill('Pending review',2);
    return <article key={title} className={`ubl-performance-card${column?' ubl-performance-actual':''}`} aria-label={column?'Actual completed UPS jobs':'Budgeted active UPS sites'}><header><h4>{title}</h4><span className="pz-caption">{column?'Approved closed jobs':hasMasterImport?'Active sites · imported orders included':'Received IPO sites · approved budgets'}</span></header><dl>{['No. of sites','Total Value','Total Cost','Markup','Markup %'].map((label,i)=><div key={label} className={i>=3?'ubl-performance-profit':''}><dt>{label}</dt><dd>{values[i]}{i===0&&<small> {column?'closed':budgetedSites===1?'site':'sites'}</small>}</dd></div>)}</dl></article>;
   })}</div>
   <p className="pz-caption pz-ups-note">{hasMasterImport?'Budgeted figures include imported active sites at approved configuration prices and current budgets; existing issued budgets are retained.':'Budgeted figures include received IPO sites only.'} Actual results include only Management-approved job closures; pending jobs and closure drafts are excluded.</p>
  </section>}
  </UpsActiveSites>}
  <div className="pz-ups-toolbar"><label className="pz-field">Search confirmed UPS orders<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="IPO, branch, code, configuration or order number"/></label><Button variant="neutral" loading={loading} loadingLabel="Refreshing…" onClick={()=>void load()}>Refresh</Button></div>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!data&&loading&&<p role="status">Loading confirmed UPS orders…</p>}
  {data&&<><p className="pz-caption">{rows.length} of {data.rows.length} confirmed orders</p><div className="pz-table-scroll"><table className="pz-ups-orders"><thead><tr>{['Site / branch code','IPO / order','Configuration','Approval date','Payable incl. GST','Budgeted cost excl. GST','Budgeted profit excl. GST','Markup','Next actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
   {rows.map((r:any)=><tr key={r.id}><td><strong>{r.site}</strong><br/>{r.siteCode}</td><td><strong>{r.number}</strong>{r.orderNumber&&<><br/>Order {r.orderNumber}</>}</td><td>{r.configuration}</td><td>{r.approvalDate}</td><td className="numeric">{money(r.payable)}</td><td className="numeric">{money(r.budgetedCost)}</td><td className="numeric">{money(r.budgetedProfit)}</td><td className="numeric">{r.markupPercent===null?'Not available':`${decimalDisplay(r.markupPercent,0)}%`}</td><td><div className="pz-action-row"><Button variant="secondary" onClick={()=>setSelected(selected===r.id?undefined:r.id)}>Preview</Button><a className="pz-ups-download" href={`/api/orders/${r.id}/ipo.pdf`} download>Download</a></div></td></tr>)}
   {!rows.length&&<tr><td colSpan={9}>{search?'No confirmed UPS orders match this search.':'No confirmed UPS orders yet.'}</td></tr>}
  </tbody></table></div></>}
  {current&&<section className="pz-stack" aria-label={`Review ${current.number}`}><h3>{current.number} · {current.site}</h3><details className="pz-document-review" open><summary><span>Open IPO and PT Preview</span><Icon name="chevron"/></summary><DocumentPreview url={`/api/orders/${current.id}/ipo.pdf`} title={`${current.number} · IPO and PT`}/></details></section>}
 </section>;
}
