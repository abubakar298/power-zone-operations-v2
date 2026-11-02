import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {InventoryCatalogue} from '../components/InventoryCatalogue.js';
import {Button} from '../ui/Button.js';
export function InventoryItems({session}:{session:Session}){
 const [data,setData]=useState<any>(),[error,setError]=useState('');
 async function load(){setError('');try{setData(await api('/material-dispatches/item-database'));}catch(e){setError((e as Error).message);throw e;}}
 useEffect(()=>{void load().catch(()=>{});},[]);
 return <section className="pz-panel pz-stack"><h1>Item ID Database</h1>{error&&<p role="alert">{error}</p>}{data?<InventoryCatalogue descriptionsOnly session={session} data={data} onSaved={load}/>:!error?<p role="status">Loading items…</p>:<Button onClick={()=>void load().catch(()=>{})}>Try again</Button>}</section>;
}
