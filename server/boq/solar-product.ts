/** Resolve panel tax identity from saved master categories, never editable customer wording. */
export function isSolarPanelProduct(item:{key:string;item_group?:string;costingCategory?:string;phase?:string}) {
  return item.key==='Solar PV Modules'||item.item_group==='Solar Panels'||item.costingCategory==='Solar PV Modules'||item.phase==='Solar Panels';
}
