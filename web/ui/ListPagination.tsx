import {useEffect,useState} from 'react';
import {Button} from './Button.js';
import './list-pagination.css';
export {paginateRows} from '../../shared/list-pagination.js';
export function useListPage(key:string){
 const [state,setState]=useState({key,page:0});
 useEffect(()=>setState(old=>old.key===key?old:{key,page:0}),[key]);
 return [state.key===key?state.page:0,(page:number)=>setState({key,page})] as const;
}
export function ListPagination({pagination:p,onPageChange,label='records'}:{pagination:{page:number;pages:number;start:number;end:number;total:number};onPageChange:(page:number)=>void;label?:string}){
 if(p.pages<=1)return null;
 return <nav className="pz-list-pagination" aria-label={label+' pages'}><span role="status">Showing {p.start+1}–{p.end} of {p.total} {label}</span><div><Button variant="neutral" disabled={p.page===0} onClick={()=>onPageChange(p.page-1)}>Previous</Button><span>Page {p.page+1} of {p.pages}</span><Button variant="neutral" disabled={p.page+1>=p.pages} onClick={()=>onPageChange(p.page+1)}>Next</Button></div></nav>;
}
