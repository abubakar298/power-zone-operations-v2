import './accounts-closure-waiting.css';
import {useState} from 'react';
import {recentFirst} from '../../shared/recent-records.js';
import {Field} from '../ui/Field.js';
import {ListPagination,paginateRows,useListPage} from '../ui/ListPagination.js';

type WaitingEntry={id:string;created_at?:string;entry_date:string;pt_reference:string;snapshot:{siteName?:string;ipo?:string;customer?:string}};

export function AccountsClosureWaiting({entries}:{entries:WaitingEntry[]}){
 const [search,setSearch]=useState('');
 const query=search.trim().toLocaleLowerCase();
 const rows=recentFirst(entries,p=>Date.parse(p.created_at??p.entry_date)||0).filter(p=>[p.snapshot.siteName,p.snapshot.ipo,p.snapshot.customer,p.pt_reference].some(value=>String(value??'').toLocaleLowerCase().includes(query)));
 const [page,setPage]=useListPage(JSON.stringify(rows.map(p=>p.id)));
 const pagination=paginateRows(rows,page);
 return <section className="accounts-closure-waiting" aria-labelledby="closure-waiting-heading">
  <header className="accounts-panel-heading"><h3 id="closure-waiting-heading">PT recorded · awaiting material report</h3><span>{rows.length} of {entries.length} jobs</span></header>
  <p className="accounts-panel-help">PT entry is already saved. The material usage report must be linked to Accounts before closure can open. This is separate from warehouse returns.</p>
  <Field id="closure-waiting-search" label="Search site, IPO, customer or PT reference"><input id="closure-waiting-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search waiting jobs"/></Field>
  <div className="pz-table-scroll"><table className="accounts-closure-waiting-table">
   <thead><tr><th>SR#</th><th>Site / IPO</th><th>PT reference</th><th>PT entry date</th></tr></thead>
   <tbody>{pagination.rows.map((p,n)=><tr key={p.id}><td>{pagination.start+n+1}</td><td><strong>{p.snapshot.siteName||'Site not recorded'}</strong><small>{p.snapshot.ipo}</small></td><td>{p.pt_reference}</td><td>{p.entry_date.slice(0,10)}</td></tr>)}</tbody>
  </table></div>
  <ListPagination pagination={pagination} onPageChange={setPage} label="waiting jobs"/>
  {!rows.length&&<p role="status">No waiting jobs match your search.</p>}
 </section>;
}
