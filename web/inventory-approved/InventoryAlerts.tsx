import type {Session} from '../api.js';
import {MaterialCorrectionAlerts} from '../components/MaterialCorrectionAlerts.js';
/** Inventory's Alerts page. Alerts live here so the dashboard opens on its metrics. */
export function InventoryAlerts({session}:{session:Session}){
 return <section className="pz-stack"><div className="ob-page-title"><div><h1>Alerts</h1><p>Open items that need Inventory's review. Resolved alerts leave this list.</p></div></div><MaterialCorrectionAlerts session={session} inventory/></section>;
}
