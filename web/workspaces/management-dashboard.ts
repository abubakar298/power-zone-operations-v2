export type UpsDashboardRow = {
  id:string; site:string; siteCode?:string; projectReference?:string;
  number?:string; orderNumber?:string; status:string;
  completion?:unknown; operationalCompletion?:unknown;
};
export type UpsDashboardData = {
  register:{rows:UpsDashboardRow[]};
};

// Use the same saved, merged register as the UBL UPS workspace. Batch capacity,
// payment receipts and delivery alone are not IPOs or installation completion.
export function upsDashboardSummary(data:UpsDashboardData){
  const rows=data.register.rows;
  const installed=rows.filter(isInstalledUpsSite).length;
  return {received:rows.length,installed,completionUnconfirmed:rows.length-installed};
}
export function isInstalledUpsSite(row:UpsDashboardRow){
  return Boolean(row.completion||row.operationalCompletion);
}
