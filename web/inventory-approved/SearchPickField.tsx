import {useEffect,useId,useRef,useState} from 'react';
export type PickOption={value:string;primary:string;detail?:string;secondary?:string};
const shown=50;
/** Searchable pick list in the Original DO style: two readable lines per option inside the
 * panel, typing narrows the list, and an optional action sits at the bottom. */
export function SearchPickField({id,options,value,disabled,placeholder,onSelect,action,emptyText='Nothing matches this search.'}:{id:string;options:PickOption[];value:string;disabled:boolean;placeholder:string;onSelect:(value:string)=>void;action?:{label:string;onClick:()=>void};emptyText?:string}){
 const selected=options.find(o=>o.value===value),label=(o:PickOption)=>o.primary+(o.detail?' · '+o.detail:'');
 const [text,setText]=useState(selected?label(selected):''),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),listId=useId(),showing=useRef(selected?label(selected):'');
 // A cleared selection empties the box only when it still shows that selection, never while typing.
 useEffect(()=>{if(selected){showing.current=label(selected);setText(showing.current);}else if(!value){const old=showing.current;showing.current='';setText(t=>t===old?'':t);}},[value,selected?.value]);
 useEffect(()=>{const dismiss=(e:Event)=>{if(e.target instanceof Node&&!root.current?.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',dismiss);document.addEventListener('focusin',dismiss);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('focusin',dismiss);};},[]);
 const query=text.trim().toLowerCase(),filtering=!!query&&(!selected||label(selected)!==text);
 const matches=filtering?options.filter(o=>[o.primary,o.detail,o.secondary].join(' ').toLowerCase().includes(query)):options;
 const choose=(o:PickOption)=>{onSelect(o.value);showing.current=label(o);setText(showing.current);setOpen(false);};
 return <div ref={root} className="original-do-field">
  <input id={id} role="combobox" aria-expanded={!disabled&&open} aria-controls={listId} aria-autocomplete="list" autoComplete="off" disabled={disabled} value={text} placeholder={placeholder}
   onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)}
   onChange={e=>{const next=e.target.value;setText(next);setOpen(true);const hit=options.find(o=>o.primary.trim().toLowerCase()===next.trim().toLowerCase());if(hit)onSelect(hit.value);else if(value)onSelect('');}}
   onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='Enter'&&open){e.preventDefault();if(matches.length===1)choose(matches[0]);}}}/>
  {open&&!disabled&&<div className="original-do-results">
   <div id={listId} role="listbox" aria-label={placeholder}>
    {matches.slice(0,shown).map(o=><button type="button" role="option" aria-selected={o.value===value} key={o.value} title={o.secondary} onClick={()=>choose(o)}>
     <strong>{o.primary}{o.detail&&<span> · {o.detail}</span>}</strong>
     {o.secondary&&<small>{o.secondary}</small>}
    </button>)}
    {!matches.length&&<p className="original-do-empty">{emptyText}</p>}
   </div>
   {matches.length>shown&&<p className="original-do-empty">Showing {shown} of {matches.length}. Type to narrow the list.</p>}
   {action&&<button type="button" className="original-do-external" onClick={()=>{setOpen(false);action.onClick();}}>{action.label}</button>}
  </div>}
 </div>;
}
