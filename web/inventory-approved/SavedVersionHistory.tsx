import {useState} from 'react';
import {api} from '../api.js';
export function SavedVersionHistory({id,version,kind}:{id:string;version:number;kind:'site'|'parent'}){
 const [rows,setRows]=useState<{version:number;at:string;reason:string}[]>(),[error,setError]=useState('');
 return <section className="pz-panel"><details onToggle={e=>{if(!e.currentTarget.open)return;setError('');void api<{versions:NonNullable<typeof rows>}>('/material-dispatches/'+(kind==='site'?'site-plans/':'drafts/')+id+'/history').then(r=>setRows(r.versions)).catch(e=>setError(e.message));}}><summary>Version history · current version {version}</summary>{error&&<p role="alert">{error}</p>}{rows?<table className="ob-table"><thead><tr><th>Version</th><th>Saved</th><th>Reason</th></tr></thead><tbody>{rows.map(r=><tr key={r.version}><td>{r.version}</td><td>{new Date(r.at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'})}</td><td>{r.reason}</td></tr>)}</tbody></table>:!error&&<p role="status">Loading saved history…</p>}</details></section>;
}
