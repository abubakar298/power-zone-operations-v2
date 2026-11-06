/** Actual completion dates only: document movement and planned dates are not completion. */
export function operationsCompletionDate(site:{installation?:boolean|null;qcJob?:{date?:string};qc?:Record<string,{date?:string}>;completionDate?:unknown;completedDate?:unknown;installationDate?:unknown;deliveryDate?:string}){
 const candidates=site.installation===false?[site.deliveryDate]:[site.qcJob?.date,site.qc?.signoff?.date,site.qc?.handover?.date,site.completionDate,site.completedDate,site.installationDate];
 return candidates.find((v):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
}
