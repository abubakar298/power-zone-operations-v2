import {Children, type ReactNode} from 'react';
import {ListPagination,paginateRows,useListPage} from './ListPagination.js';

/** Page search results without truncating their source, totals or selection state. */
export function PagedTableBody({children,label='records'}:{children:ReactNode;label?:string}){
 const rows=Children.toArray(children);
 const key=JSON.stringify(rows.map((row:any)=>row.key));
 const [page,setPage]=useListPage(key);
 const pagination=paginateRows(rows,page);
 return <tbody>{pagination.rows}{pagination.pages>1&&<tr className="pz-pagination-row"><td colSpan={99}><ListPagination pagination={pagination} onPageChange={setPage} label={label}/></td></tr>}</tbody>;
}

export function PagedResults({children,label='documents',className}:{children:ReactNode;label?:string;className?:string}){
 const rows=Children.toArray(children),key=JSON.stringify(rows.map((row:any)=>row.key));
 const [page,setPage]=useListPage(key),pagination=paginateRows(rows,page);
 return <div className={className}>{pagination.rows}<ListPagination pagination={pagination} onPageChange={setPage} label={label}/></div>;
}
