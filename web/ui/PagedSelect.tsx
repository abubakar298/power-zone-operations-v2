import {Children,cloneElement,isValidElement,type ComponentProps,type ReactElement} from 'react';
import {ListPagination,paginateRows,useListPage} from './ListPagination.js';

/** Page filtered native choices while retaining the current value on every page. */
export function PagedSelect({children,value,...props}:ComponentProps<'select'>){
 const options=Children.toArray(children).filter(isValidElement) as ReactElement<ComponentProps<'option'>>[];
 const placeholders=options.filter(o=>String(o.props.value??'')==='');
 const matches=options.filter(o=>String(o.props.value??'')!=='');
 const [page,setPage]=useListPage(JSON.stringify(matches.map(o=>o.key)));
 const pagination=paginateRows(matches,page),selected=matches.find(o=>String(o.props.value)===String(value));
 return <div className="pz-paged-select"><select {...props} value={value}>{placeholders}{selected&&!pagination.rows.includes(selected)&&cloneElement(selected,{hidden:true})}{pagination.rows}</select><ListPagination pagination={pagination} onPageChange={setPage} label={String(props['aria-label']??'product')+' choices'}/></div>;
}
