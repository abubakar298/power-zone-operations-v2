import {useEffect,useState} from 'react';
import {api} from '../api.js';
import {decimalDisplay} from '../numbers.js';
type Item={key:string;itemId:string;description:string;quantity:string};
export function AccountsLocalPurchases({siteId}:{siteId:string}){
 const [items,setItems]=useState<Item[]>(),[error,setError]=useState('');
 useEffect(()=>{let active=true;setItems(undefined);setError('');void api<{items:Item[]}>('/accounts-workspace/site-local-purchases?siteId='+encodeURIComponent(siteId)).then(v=>{if(active)setItems(v.items);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[siteId]);
 return <section className="accounts-record-section"><h3>Local Purchase Items</h3><p>Recorded by QC for Accounts PT/cost entry. No expense or payment is posted automatically.</p>{error?<p role="alert" className="form-error">{error}</p>:!items?<p role="status">Loading local purchases…</p>:!items.length?<p>No local purchase items recorded.</p>:<div className="pz-table-scroll"><table className="accounts-signed-document-table"><thead><tr><th>SR#</th><th>Item ID</th><th>Description</th><th>Quantity</th></tr></thead><tbody>{items.map((i,n)=><tr key={i.key}><td>{n+1}</td><td>{i.itemId}</td><td>{i.description}</td><td>{decimalDisplay(i.quantity).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1')}</td></tr>)}</tbody></table></div>}</section>;
}
