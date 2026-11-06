/** Shared survey fields have one source: saved BOQ inputs and linked master records. */
export function surveySharedValues(standard:any, customer:any, site:any, surveyors:string){
 return {customerName:customer.name,siteName:site.name,siteCode:site.code,siteAddress:site.location,siteContact:site.contact_person,sitePhone:site.contact_phone,siteEmail:customer.email,surveyors,bessId:standard.bessId,panelQty:standard.panelQty,panelWattage:standard.panelWattage,structure:standard.structure,family:standard.family,inverter:standard.inverter,batteryKwh:standard.batteryKwh};
}
