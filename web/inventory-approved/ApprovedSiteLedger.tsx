import {draftItemId} from './issuance-catalogue.js';
import {navigateInventory} from './navigation.js';
import {api} from '../api.js';
import './site-ledger.css';
import React,{useEffect,useMemo,useState} from 'react';
import {Decimal} from 'decimal.js';
import {finalIssuanceItems as items} from './issuance-catalogue.js';
const flagSource={flags:[]};
import type {IssueRecord} from './SiteIssueDocument.js';
const issueProjects: {id:string;site:string;customer:string;ipo:string;installation?:boolean}[]=[];
import {Field} from '../ui/Field.js';
import {Button} from '../ui/Button.js';
import {StatusBadge} from '../ui/StatusBadge.js';

type MovementKind='issue'|'return'|'reported_return'|'local_purchase'|'unmatched_return';
type ImportedMovement={id:string;siteId:string;site:string;customer:string;ipo:string;itemId:string;description:string;unit:string;date:string;document:string;documentType:string;kind:MovementKind;quantity:string;issuedQty?:string;usedQty?:string;reportedReturnQty?:string;warehouse:string;reference:string;notes:string;condition:string;evidence:string;sourceSheet:string;sourceType:string;status:string;replacement:boolean;faulty:boolean};
type LedgerImport={nativeSites?:{id:string;site:string;customer:string;ipo:string;draftId:string;parent:boolean}[];source:string;sourceWorkbook:string;capturedDate:string;sites:{id:string;site:string;customer:string;ipo:string;deliveryOnly?:boolean}[];events:ImportedMovement[];unmappedReturns:ImportedMovement[];coverage:Record<string,number>};
type IrrFlag={id:string;site:string;customer:string;ipo:string;siteOrder:string;relatedDocuments:string;status:string;reason:string;sourceThread:string;deliveryOnly:boolean;deliveryOnlyReason?:string};
type SiteOption={id:string;site:string;customer:string;ipo:string;deliveryOnly?:boolean;aliasIds?:string[]};
type EventRow={site:string;siteId:string;customer:string;itemId:string;description:string;unit:string;date:string;document:string;documentType:string;kind:'Issue'|'Return'|'IRR return'|'Local purchase'|'Unmatched return';dr:Decimal;cr:Decimal;reportedReturn:Decimal;status:string;replacement:boolean;faulty:boolean;warehouse:string;ipo:string;reference:string;notes:string;evidence:string;source:string};
type FilterTab='all'|'DO'|'IGP/IRR'|'Local purchase'|'Unmatched';
const flags=(flagSource as {flags:IrrFlag[]}).flags;
const activeFlags=flags.filter(flag=>!flag.deliveryOnly);
const inventoryItems=items as {id:string;description:string;unit?:string}[];
const qty=(value:unknown)=>{try{return new Decimal(String(value??0).replaceAll(',','')||0);}catch{return new Decimal(0);}};
const display=(value:Decimal)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value.toNumber());
const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const docNumbers=(value:string)=>new Set((value.match(/\d+/g)||[]).map(number=>number.replace(/^0+/,'')||'0'));
const itemMeta=(id:string)=>inventoryItems.find(item=>item.id===id);
function importedToRows(data:LedgerImport):EventRow[]{
 const all=[...data.events,...data.unmappedReturns];
 return all.map(event=>{
  const amount=qty(event.kind==='local_purchase'?(event.issuedQty||event.quantity):event.quantity);
  const kind:EventRow['kind']=event.kind==='issue'?'Issue':event.kind==='return'?'Return':event.kind==='reported_return'?'IRR return':event.kind==='local_purchase'?'Local purchase':'Unmatched return';
  return {site:event.site,siteId:event.siteId,customer:event.customer,itemId:draftItemId(event.itemId,event.description),description:event.description||itemMeta(event.itemId)?.description||event.itemId,unit:event.unit||itemMeta(event.itemId)?.unit||'',date:event.date,document:event.document,documentType:event.documentType,kind,dr:event.kind==='issue'||event.kind==='local_purchase'?amount:new Decimal(0),cr:event.kind==='return'?qty(event.quantity):new Decimal(0),reportedReturn:event.kind==='reported_return'?qty(event.quantity):event.kind==='local_purchase'?qty(event.reportedReturnQty):new Decimal(0),status:event.status,replacement:event.replacement,faulty:event.faulty,warehouse:event.warehouse,ipo:event.ipo,reference:event.reference,notes:[event.notes,draftItemId(event.itemId,event.description)!==event.itemId?`Source Item ID: ${event.itemId}`:''].filter(Boolean).join(' - '),evidence:event.evidence,source:event.sourceType||event.sourceSheet};
 });
}
function savedIssueRows(issues:IssueRecord[]):EventRow[]{
 const rows:EventRow[]=[];
 issues.filter(record=>record.recorded).forEach(record=>{
  const project=issueProjects.find(entry=>entry.id===record.project),site=project?.site||record.project,customer=project?.customer||'',base={site,siteId:record.project,customer,unit:'',document:record.dispatchNumber||record.number,documentType:'DO',warehouse:record.warehouse||'',ipo:project?.ipo||'',reference:'',notes:(record.audit||[]).join(' '),evidence:'',source:'Saved local issuance',replacement:/replace/i.test([record.number,...(record.audit||[])].join(' ')),faulty:false};
  Object.entries(record.quantities||{}).forEach(([itemId,value])=>{const amount=qty(value);if(amount.gt(0)){const meta=itemMeta(itemId);rows.push({...base,itemId,description:meta?.description||itemId,unit:meta?.unit||'',date:record.date||'',kind:'Issue',dr:amount,cr:new Decimal(0),reportedReturn:new Decimal(0),status:'Issued'});}});
  (record.extras||[]).forEach(line=>{if(!line.id)return;const amount=qty(line.quantity);if(amount.gt(0)){rows.push({...base,itemId:line.id,description:line.description||itemMeta(line.id)?.description||line.id,unit:line.unit||itemMeta(line.id)?.unit||'',date:record.date||'',kind:'Issue',dr:amount,cr:new Decimal(0),reportedReturn:new Decimal(0),status:'Issued'});}});
 });
 return rows;
}
function flagMatches(flag:IrrFlag,site:SiteOption,events:ImportedMovement[]):boolean{
 const siteIds=new Set(site.aliasIds||[site.id]),siteEvents=events.filter(event=>siteIds.has(event.siteId)),refs=docNumbers(flag.relatedDocuments);
 if(siteEvents.some(event=>[...docNumbers(event.document)].some(number=>refs.has(number))))return true;
 const siteName=normalize(site.site),flagName=normalize(flag.site),siteIpo=normalize(site.ipo),flagIpo=normalize(flag.ipo),order=normalize(flag.siteOrder);
 if(siteName&&siteName===flagName&&(!siteIpo||!flagIpo||siteIpo.includes(flagIpo)))return true;
 return !!(order&&siteIpo.includes(order)&&siteName&&flagName&&(siteName.includes(flagName)||flagName.includes(siteName)));
}
function statusTone(event:EventRow):'success'|'warning'|'pending'{return event.kind==='Return'?'success':event.kind==='IRR return'||event.kind==='Unmatched return'||event.replacement||event.faulty?'warning':'pending';}
function MovementTable({events,balanceEvents=events}:{events:EventRow[];balanceEvents?:EventRow[]}){
 const [page,setPage]=useState(0);
 useEffect(()=>setPage(0),[events.length,events[0],events.at(-1)]);
 const sorted=[...events].sort((a,b)=>a.date.localeCompare(b.date)||a.site.localeCompare(b.site)||a.document.localeCompare(b.document)||a.itemId.localeCompare(b.itemId));
 const balanceByEvent=new Map<EventRow,Decimal>();
 const balanceSorted=[...balanceEvents].sort((a,b)=>a.date.localeCompare(b.date)||a.site.localeCompare(b.site)||a.document.localeCompare(b.document)||a.itemId.localeCompare(b.itemId));
 const running=new Map<string,Decimal>();
 for(const event of balanceSorted){const key=`${event.siteId}|${event.itemId}`,balance=(running.get(key)||new Decimal(0)).add(event.dr).sub(event.cr);running.set(key,balance);balanceByEvent.set(event,balance);}
 const pageCount=Math.max(1,Math.ceil(sorted.length/50)),currentPage=Math.min(page,pageCount-1),visible=sorted.slice(currentPage*50,currentPage*50+50);
 return <div className="site-ledger-results"><div className="site-ledger-pagination"><span>{sorted.length?`${currentPage*50+1}–${Math.min((currentPage+1)*50,sorted.length)} of ${sorted.length} movements`:'0 movements'}</span><div><Button variant="neutral" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</Button><span>Page {currentPage+1} of {pageCount}</span><Button variant="neutral" disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}>Next</Button></div></div><div className="inventory-matrix"><div className="inventory-matrix-scroll site-ledger-table-scroll" tabIndex={0} role="region" aria-label="Site item movements"><table className="inventory-ledger-table site-ledger-table"><thead><tr><th>Date</th><th>Site / IPO</th><th>Document</th><th>Item ID / name</th><th>Type</th><th>Warehouse / source</th><th className="inventory-ledger-number">DR · to site</th><th className="inventory-ledger-number">CR · returned</th><th className="inventory-ledger-number">IRR return pending</th><th className="inventory-ledger-number">Net at site</th><th>Details / evidence</th></tr></thead><tbody>{visible.map((event,index)=>{const balance=balanceByEvent.get(event)||new Decimal(0),detail=[event.reference,event.notes,event.source].filter(Boolean).join(' · ');return <tr key={`${event.document}-${event.itemId}-${index}`}><td>{event.date||'Date not recorded'}</td><td><strong>{event.site||'Site not matched'}</strong><small>{[event.customer,event.ipo].filter(Boolean).join(' · ')}</small></td><th scope="row">{event.document}<small>{event.documentType}</small></th><td><strong>{event.itemId}</strong><small>{event.description}{event.unit?` · ${event.unit}`:''}</small></td><td><div className="site-ledger-movement-tags">{event.faulty&&<StatusBadge tone="warning">Faulty</StatusBadge>}{event.replacement&&<StatusBadge tone="warning">Replacement</StatusBadge>}<span>{event.kind}</span></div></td><td>{event.warehouse||'—'}</td><td className="inventory-ledger-number">{event.dr.gt(0)?display(event.dr):'—'}</td><td className="inventory-ledger-number">{event.cr.gt(0)?display(event.cr):'—'}</td><td className="inventory-ledger-number">{event.reportedReturn.gt(0)?display(event.reportedReturn):'—'}</td><td className="inventory-ledger-number"><strong>{event.kind==='Unmatched return'?'—':display(balance)}</strong></td><td>{detail||'—'}{event.evidence&&<a className="site-ledger-evidence-link" href={event.evidence} target="_blank" rel="noreferrer">Source ↗</a>}<small>{event.status}</small></td></tr>})}</tbody></table>{!sorted.length&&<p className="inventory-empty">No movement records match these filters.</p>}</div></div></div>;
}
export function IrrFollowUp({onOpen}:{onOpen:(flag:IrrFlag|null)=>void}){
 return <section className="site-ledger-followup" aria-label="Installation report follow-up"><div className="site-ledger-followup-heading"><div><span className="inventory-eyebrow">INSTALLATION FOLLOW-UP</span><h2>IRR reports to follow up</h2><p>Installation-required IPOs where an IRR was not located in the checked source records. {flags.filter(flag=>flag.deliveryOnly).length} delivery-only orders are excluded.</p></div><StatusBadge tone={activeFlags.length?'warning':'success'}>{activeFlags.length} open flags</StatusBadge></div><div className="site-ledger-followup-list">{activeFlags.slice(0,6).map(flag=><button type="button" key={flag.id} onClick={()=>onOpen(flag)}><span><strong>{flag.site||'Site name not recorded'}</strong><small>{[flag.customer,flag.ipo,flag.siteOrder&&`Site order ${flag.siteOrder}`].filter(Boolean).join(' · ')}</small></span><span className="site-ledger-followup-badge">IRR follow-up</span></button>)}</div><button className="site-ledger-followup-all" type="button" onClick={()=>onOpen(null)}>Open the full Site Ledger to search and filter all movements →</button></section>;
}
export function SiteLedger({issues=[],initialFlagId,onFlagOpened}:{issues?:IssueRecord[];initialFlagId?:string;onFlagOpened?:()=>void}){
 const[data,setData]=useState<LedgerImport|null>(null),[loadError,setLoadError]=useState('');
 useEffect(()=>{let active=true;void api<LedgerImport>('/material-dispatches/site-ledger-history').then(data=>{if(active)setData(data);}).catch(()=>{if(active)setLoadError('Imported movement data could not be loaded.');});return()=>{active=false;};},[]);
 const[search,setSearch]=useState(''),[selectedSite,setSelectedSite]=useState(''),[tab,setTab]=useState<FilterTab>('all'),[itemFilter,setItemFilter]=useState(''),[documentFilter,setDocumentFilter]=useState('all'),[conditionFilter,setConditionFilter]=useState<'all'|'faulty'|'replacement'>('all');
 const flagsForRender=activeFlags;
 const importedEvents=data?importedToRows(data):[];
 const localEvents=savedIssueRows(issues);
 const allEvents=useMemo(()=>{
  const imports=[...importedEvents];
  const signature=(event:EventRow)=>`${normalize(event.site)}|${normalize(event.document)}|${normalize(event.itemId)}|${normalize(event.warehouse)}|${event.dr.toString()}|${event.cr.toString()}`;
  const seen=new Set(imports.map(signature));
  return imports.concat(localEvents.filter(event=>!seen.has(signature(event))));
 },[data,issues]);
 const siteOptions=useMemo(()=>{
  const base=(data?.sites||[]).map(site=>({...site}));
  const byId=new Map(base.map(site=>[site.id,site]));
  for(const event of localEvents)if(!byId.has(event.siteId))byId.set(event.siteId,{id:event.siteId,site:event.site,customer:event.customer,ipo:event.ipo});
  const rows=[...byId.values()],groups=new Map<string,SiteOption[]>();
  const projectRef=(ipo:string)=>normalize(ipo).match(/\b(?:chp|ipo)\s*\d+[a-z]?/)?.[0]||normalize(ipo);
  const orderRef=(ipo:string)=>ipo.match(/\((\d+\s*\/\s*\d+)\)/)?.[1].replace(/\s+/g,'')||'';
  for(const site of rows){const key=normalize(site.site);groups.set(key,[...(groups.get(key)||[]),site]);}
  const result:SiteOption[]=[];
  for(const group of groups.values()){
   const projects=[...new Set(group.map(site=>projectRef(site.ipo)).filter(Boolean))];
   const buckets=projects.length<=1?[group]:[...projects.map(project=>group.filter(site=>projectRef(site.ipo)===project)),...group.filter(site=>!projectRef(site.ipo)).map(site=>[site])];
   for(const bucket of buckets){
    const orders=[...new Set(bucket.map(site=>orderRef(site.ipo)).filter(Boolean))];
    const mergeGroup=orders.length<=1?bucket:bucket.filter(site=>orderRef(site.ipo));
    const canonical=mergeGroup.find(site=>orderRef(site.ipo))||mergeGroup.find(site=>projectRef(site.ipo))||mergeGroup[0];
    if(canonical)result.push({...canonical,aliasIds:mergeGroup.map(site=>site.id)});
   }
  }
  return result.sort((a,b)=>a.site.localeCompare(b.site));
 },[data,issues]);
 useEffect(()=>{if(!initialFlagId||!data)return;const flag=flagsForRender.find(entry=>entry.id===initialFlagId);if(!flag)return;const related=docNumbers(flag.relatedDocuments);const linked=data.events.find(event=>[...docNumbers(event.document)].some(number=>related.has(number)));const option=linked?siteOptions.find(site=>site.id===linked.siteId):siteOptions.find(site=>normalize(site.site)===normalize(flag.site));setSelectedSite(option?.id||'');setSearch(option?.site||flag.site);onFlagOpened?.();},[initialFlagId,data]);
 const selected=siteOptions.find(site=>site.id===selectedSite);
 const selectedFlags=selected?flagsForRender.filter(flag=>flagMatches(flag,selected,data?.events||[])):[];
 const selectedIds=new Set(selected?.aliasIds||[selected?.id||'']);
 // A selected site's movements must stay scoped to that site's IDs. Matching a
 // follow-up by digit fragments (for example the "01" suffix in DO617-01)
 // would pull in unrelated documents from every other site.
 const eventsInSite=selected?allEvents.filter(event=>selectedIds.has(event.siteId)):allEvents;
 const matches=!selectedSite&&search.trim()?siteOptions.filter(site=>`${site.site} ${site.customer} ${site.ipo}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0,10):[];
 const filtered=eventsInSite.filter(event=>{
  const tabMatch=tab==='all'||tab==='DO'&&event.documentType==='DO'||tab==='IGP/IRR'&&(event.documentType==='IGP'||event.documentType==='IRR')||tab==='Local purchase'&&event.documentType==='Local purchase'||tab==='Unmatched'&&event.kind==='Unmatched return';
  const docMatch=documentFilter==='all'||normalize(event.documentType)===normalize(documentFilter);
  const conditionMatch=conditionFilter==='all'||conditionFilter==='faulty'&&event.faulty||conditionFilter==='replacement'&&event.replacement;
  const itemMatch=!itemFilter||`${event.itemId} ${event.description}`.toLowerCase().includes(itemFilter.trim().toLowerCase());
  const searchMatch=!!selected||!search||`${event.site} ${event.customer} ${event.ipo} ${event.document} ${event.itemId} ${event.description}`.toLowerCase().includes(search.trim().toLowerCase());
  return tabMatch&&docMatch&&conditionMatch&&itemMatch&&searchMatch;
 });
 const summaries=useMemo(()=>{const map=new Map<string,{id:string;description:string;unit:string;issued:Decimal;returned:Decimal;pending:Decimal;balance:Decimal}>();for(const event of eventsInSite){const current=map.get(event.itemId)||{id:event.itemId,description:event.description,unit:event.unit,issued:new Decimal(0),returned:new Decimal(0),pending:new Decimal(0),balance:new Decimal(0)};current.issued=current.issued.add(event.dr);current.returned=current.returned.add(event.cr);current.pending=current.pending.add(event.reportedReturn);current.balance=current.balance.add(event.dr).sub(event.cr);map.set(event.itemId,current);}return [...map.values()].sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));},[eventsInSite]);
 const pendingReplacement=useMemo(()=>{const balances=new Map<string,Decimal>();for(const event of [...eventsInSite].sort((a,b)=>a.date.localeCompare(b.date))){const key=`${event.siteId}|${event.itemId}`,current=balances.get(key)||new Decimal(0);if(event.kind==='Issue'&&event.replacement)balances.set(key,current.add(event.dr));else if(event.kind==='Return'&&event.faulty)balances.set(key,current.sub(event.cr));}return [...balances.values()].filter(value=>value.gt(0)).length;},[eventsInSite]);
 const actionProjects=(data?.nativeSites??[]).filter(p=>selected&&(selectedIds.has(p.id)||normalize(p.site)===normalize(selected.site)&&normalize(p.ipo)===normalize(selected.ipo)));
 const documentTypes=[...new Set((data?.events||[]).map(event=>event.documentType))].sort();
 return <section className="site-ledger-page">
  <div className="inventory-page-title"><div><h1>Site Ledger</h1><p className="inventory-footer">Search any site or item; review outward DOs, inward IGP/IRR returns, replacements and local purchases.</p></div><StatusBadge tone="warning">{data?'Shared movement history':'Loading movement history…'}</StatusBadge></div>
  {data&&<p className="site-ledger-source-note">Source: {data.source} · imported {data.capturedDate} · {data.coverage.importedEvents.toLocaleString()} movement lines. Movement history is read-only here.</p>}
  {loadError&&<p role="alert" className="inventory-date-error">{loadError}</p>}
  <section className="site-ledger-search" aria-label="Find a site"><Field id="site-ledger-search" label="Search site, customer or IPO"><input id="site-ledger-search" type="search" value={search} onChange={event=>{setSearch(event.target.value);setSelectedSite('');}} placeholder="Type a site name, customer or IPO number" autoComplete="off"/></Field>{matches.length>0&&<div className="site-ledger-search-results" role="listbox" aria-label="Matching sites">{matches.map(option=>{const warnings=activeFlags.filter(flag=>flagMatches(flag,option,data?.events||[]));return <button type="button" role="option" aria-selected={selectedSite===option.id} key={option.id} onClick={()=>{setSelectedSite(option.id);setSearch(option.site);}}><strong>{option.site}</strong><span>{[option.customer,option.ipo].filter(Boolean).join(' · ')}</span>{warnings.length>0&&<StatusBadge tone="warning">IRR follow-up · {warnings.length}</StatusBadge>}</button>})}</div>}</section>
  <section className="purchase-card"><h2>Site documents &amp; actions</h2><div className="inventory-document-actions">{(selected?actionProjects:[]).map(p=><div key={p.id}><strong>{p.ipo} · {p.site}</strong><div><Button onClick={()=>navigateInventory(p.parent?'/inventory/parent-dos/'+p.draftId:'/inventory/materials/new?site='+encodeURIComponent(p.id))}>Dispatch / view documents</Button>{p.parent&&<Button onClick={()=>navigateInventory('/inventory/parent-dos/review?draft='+encodeURIComponent(p.draftId))}>View Parent ledger</Button>}</div></div>)}</div>{!selected?<p>Select a site to view its dispatch and reconciliation actions.</p>:!actionProjects.length&&<p>No saved issuance is linked to this site.</p>}</section>
  <div className="site-ledger-filter-tabs" role="tablist" aria-label="Filter movement type">{(['all','DO','IGP/IRR','Local purchase','Unmatched'] as FilterTab[]).map(value=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>setTab(value)}>{value==='all'?'All movements':value}{value==='all'&&data?` · ${data.coverage.importedEvents+data.unmappedReturns.length}`:''}</button>)}</div>
  <section className="site-ledger-filters" aria-label="Filter site movements"><Field id="site-ledger-item-filter" label="Item ID or description"><input id="site-ledger-item-filter" type="search" value={itemFilter} onChange={event=>setItemFilter(event.target.value)} placeholder="Search item ID or name"/></Field><Field id="site-ledger-document-filter" label="Document type"><select id="site-ledger-document-filter" value={documentFilter} onChange={event=>setDocumentFilter(event.target.value)}><option value="all">All document types</option>{documentTypes.map(type=><option key={type} value={type}>{type}</option>)}</select></Field><Field id="site-ledger-condition-filter" label="Fault / replacement"><select id="site-ledger-condition-filter" value={conditionFilter} onChange={event=>setConditionFilter(event.target.value as typeof conditionFilter)}><option value="all">All conditions</option><option value="faulty">Faulty</option><option value="replacement">Replacement</option></select></Field><Button variant="neutral" className="site-ledger-reset" onClick={()=>{setSearch('');setSelectedSite('');setItemFilter('');setDocumentFilter('all');setConditionFilter('all');setTab('all');}}>Reset filters</Button></section>
  {selected&&<><div className="site-ledger-site-heading"><div><h2>{selected.site}</h2><p>{[selected.customer,selected.ipo].filter(Boolean).join(' · ')}</p></div><div className="site-ledger-status-pills">{selectedFlags.map(flag=><StatusBadge key={flag.id} tone="warning">IRR follow-up · {flag.siteOrder||flag.ipo}</StatusBadge>)}<StatusBadge tone={pendingReplacement?'warning':'success'}>{pendingReplacement?`${pendingReplacement} replacement balances pending return`:'Movement history'}</StatusBadge></div></div>{selectedFlags.map(flag=><div className="site-ledger-irr-warning" role="status" key={flag.id}><strong>Installation report follow-up: no IRR was located in the checked source records for this IPO.</strong><span>{[flag.customer,flag.ipo,flag.siteOrder&&`Site order ${flag.siteOrder}`,flag.relatedDocuments&&`Related DO ${flag.relatedDocuments}`].filter(Boolean).join(' · ')}</span><details><summary>Review note</summary><p>{flag.reason}</p>{flag.sourceThread&&<a href={flag.sourceThread} target="_blank" rel="noreferrer">Open source review thread ↗</a>}</details></div>)}<section className="site-ledger-summary" aria-label="Site ledger counts"><div><span>Item IDs</span><strong>{summaries.length}</strong></div><div><span>DO / issue rows</span><strong>{eventsInSite.filter(event=>event.kind==='Issue').length}</strong></div><div><span>Verified return rows</span><strong>{eventsInSite.filter(event=>event.kind==='Return').length}</strong></div><div><span>Items with outstanding balance</span><strong>{summaries.filter(item=>item.balance.gt(0)).length}</strong></div><div><span>IRR returns pending IGP</span><strong>{eventsInSite.filter(event=>event.kind==='IRR return').length}</strong></div></section></>}
  <section className="site-ledger-section"><div className="site-ledger-section-heading"><div><h3>{selected?'Document movements':'All site movements'}</h3><p>{selected?'DOs, IGP/IRR returns, local purchases and their source details.':'Select a site to view item balances; use filters to inspect the entire imported movement history.'}</p></div><span className="inventory-item-count">{filtered.length} movements</span></div><MovementTable events={filtered} balanceEvents={eventsInSite}/></section>
  <p className="site-ledger-note">DR records material sent to a site. CR records a warehouse return already posted as an IGP. IRR-reported quantities remain pending until their return IGP is recorded. Local purchases are shown separately and do not alter warehouse closing balances.</p>
 </section>;
}
