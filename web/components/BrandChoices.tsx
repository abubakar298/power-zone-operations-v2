import {useEffect,useState} from 'react';
import {Button} from '../ui/Button.js';
export function BrandChoices({field,category,brands,initial,onSelectionChange}:{field:string;category:string;brands:any[];initial:any;onSelectionChange?:()=>void}){
 const options=brands.filter(b=>b.category===category&&b.status==='Active'&&b.name!=='Any of the Above');
 const initialIds=()=>initial.brandSelections?.[field]??(brands.find(b=>b.id===initial.brands?.[field])?.name==='Any of the Above'?options.map(b=>b.id):initial.brands?.[field]?[initial.brands[field]]:[]);
 const [selected,setSelected]=useState<number[]>(initialIds);
 useEffect(()=>setSelected(initialIds()),[initial]);
 const change=(ids:number[])=>{setSelected(ids);requestAnimationFrame(()=>onSelectionChange?.());};
 return <div data-brand-group={field} data-original-values={JSON.stringify(initialIds())}><label htmlFor={`brand-picker-${field}`}>{category} brands</label><div className="pz-brand-chip-input">{selected.map(id=><span className="pz-brand-chip" key={id}>{options.find(b=>b.id===id)?.name??'Unavailable brand'}<Button aria-label={`Remove ${options.find(b=>b.id===id)?.name??'brand'}`} onClick={()=>change(selected.filter(value=>value!==id))}><span aria-hidden="true">×</span></Button><input type="hidden" name={`brand-${field}`} value={id}/></span>)}<select id={`brand-picker-${field}`} aria-label={`${category} brands`} value="" onChange={e=>{if(e.target.value)change([...selected,Number(e.target.value)]);}}><option value="">Select brand…</option>{options.filter(option=>!selected.includes(option.id)).map(option=><option key={option.id} value={option.id}>{option.name}</option>)}</select></div><small>Select one or more acceptable brands.</small></div>;
}
