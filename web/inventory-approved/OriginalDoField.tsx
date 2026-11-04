import {useEffect,useId,useRef,useState} from 'react';
type Site={siteName:string;ipo:string};
type Original={id:string;number:string;warehouse:string;date:string;sites:Site[]};
const shown=50;
/** Original DO: pick a saved DO (searchable, readable within the panel) or type a reference by hand.
 * A typed reference that is not a saved DO is offered as an external DO reference. */
export function OriginalDoField({id,originals,value,disabled,onSelect,onExternal}:{id:string;originals:Original[];value:string;disabled:boolean;onSelect:(id:string)=>void;onExternal:(reference:string)=>void}){
 const selected=originals.find(o=>o.id===value);
 const [text,setText]=useState(selected?.number??''),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),listId=useId();
 useEffect(()=>{if(selected)setText(selected.number);else if(!value)setText(t=>originals.some(o=>o.number===t)?'':t);},[value,selected]);
 useEffect(()=>{const dismiss=(e:Event)=>{if(e.target instanceof Node&&!root.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',dismiss);document.addEventListener('focusin',dismiss);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('focusin',dismiss);};},[]);
 const query=text.trim().toLowerCase(),filtering=!!query&&selected?.number!==text;
 const matches=filtering?originals.filter(o=>[o.number,o.date,o.warehouse,...o.sites.flatMap(s=>[s.siteName,s.ipo])].join(' ').toLowerCase().includes(query)):originals;
 const exact=originals.find(o=>o.number.trim().toLowerCase()===query);
 const choose=(o:Original)=>{onSelect(o.id);setText(o.number);setOpen(false);};
 const summary=(o:Original)=>{const names=o.sites.map(s=>s.siteName);return names.slice(0,2).join(' / ')+(names.length>2?` +${names.length-2} more`:'');};
 return <div ref={root} className="original-do-field">
  <input id={id} role="combobox" aria-expanded={!disabled&&open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" disabled={disabled} value={text} maxLength={200} placeholder="Select a saved DO or type the DO number"
   onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)}
   onChange={e=>{const next=e.target.value;setText(next);setOpen(true);const hit=originals.find(o=>o.number.trim().toLowerCase()===next.trim().toLowerCase());if(hit)onSelect(hit.id);else if(value)onSelect('');}}
   onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='Enter'&&open){e.preventDefault();if(exact)choose(exact);else if(matches.length===1)choose(matches[0]);}}}/>
  {open&&!disabled&&<div className="original-do-results">
   <div id={listId} role="listbox" aria-label="Saved original DOs">
    {matches.slice(0,shown).map(o=><button type="button" role="option" aria-selected={o.id===value} key={o.id} title={o.sites.map(s=>s.siteName).join(' / ')} onClick={()=>choose(o)}>
     <strong>{o.number}<span> · {o.date} · {o.warehouse}</span></strong>
     <small>{summary(o)||'Site not recorded'}</small>
    </button>)}
    {!matches.length&&<p className="original-do-empty">No saved DO matches “{text.trim()}”.</p>}
   </div>
   {matches.length>shown&&<p className="original-do-empty">Showing {shown} of {matches.length}. Type a DO number, site or IPO to narrow the list.</p>}
   {!!text.trim()&&!exact&&<button type="button" className="original-do-external" onClick={()=>{setOpen(false);onExternal(text.trim());}}>Use “{text.trim()}” as an external DO reference</button>}
  </div>}
 </div>;
}
