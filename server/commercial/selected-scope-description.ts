type Selection={brand:string;watts:string;structure:string;panels:number;specification?:string};
/** Catalogue text is a template; selected BOQ facts remain authoritative. */
export function selectedScopeDescription(group:'solar'|'structure',wording:string,selection:Selection){
 const {brand,watts,structure,panels}=selection;
 let description=(selection.specification?.trim()||wording)
  .replace(/\{(?:selected )?(?:solar |panel )?brand\}|brand to be confirmed/gi,brand)
  .replace(/\{(?:selected )?panel wattage\}/gi,watts)
  .replace(/\{(?:selected )?structure type\}/gi,structure)
  .replace(/\{panel quantity\}/gi,new Intl.NumberFormat('en-PK',{maximumFractionDigits:4}).format(panels));
 if(group==='structure'){
  if(!description.toLowerCase().includes(structure.toLowerCase()))description=`${structure} ${description}`;
  return description;
 }
 const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const hasBrand=description.toLowerCase().includes(brand.toLowerCase());
 const hasWatts=new RegExp(`(?:^|\\D)${escape(watts)}(?:\\D|$)`).test(description);
 if(!hasWatts){
  // Replace a rated panel prefix, not warranty years or other technical numbers.
  description=description.replace(/\b\d+(?:\.\d+)?\s*W(?:atts?)?\b/i,`${watts} W`);
  if(!new RegExp(`(?:^|\\D)${escape(watts)}(?:\\D|$)`).test(description)){
   description=description.replace(new RegExp(`^${escape(brand)}\\s*`,'i'),'');
   return `${brand} ${watts} W ${description}`;
  }
 }
 return hasBrand?description:`${brand} ${description}`;
}
