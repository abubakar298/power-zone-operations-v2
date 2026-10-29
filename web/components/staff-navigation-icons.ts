/** Presentation names only: workflow keys, labels and permissions stay unchanged. */
const icons:Record<string,string>={
 'Dashboard':'dashboard','Workspace':'dashboard','IPOs Received':'inbox','Inventory & PT':'warehouse','Job Closure':'clipboard-check','Physical Documents':'documents','Alerts':'bell',
 'Awaiting Schedule':'calendar','Scheduled Surveys':'calendar-check','Technical Review':'clipboard-check','Sent to Coordination':'send','Survey Requests':'map-pin','Design Review':'drafting','Management Review':'shield','Revisions':'revision','Ready to Send':'send','Customer Follow-up':'message','PO Receipt / Heads-up':'inbox','Order Exceptions':'alert','Advance Planning':'calendar','IPOs Shared':'share',
 'Databases':'database','Survey History':'history','Customer & Site Search':'search','Performance':'chart',
 'Stock Position':'boxes','Purchase receiving':'package-in','Material issuance':'package-out','Inter-Warehouse Transfers':'transfer','Replacements':'replacement','Site ledger':'ledger','Documents Upload':'upload','Parent DO reconciliation':'clipboard-check','Closing reconciliations':'check-circle','Minimum Closing Stock':'sliders',
 'All documents':'documents','IGPs':'package-in','OGPs':'package-out','Signed copies pending':'signature',
 'Site updates':'site','Vendors':'store','Team members':'users','Vehicles':'truck','Stage targets':'target','Batch planning':'route',
};
export const staffNavigationIcon=(label:string)=>icons[label]??'file';
