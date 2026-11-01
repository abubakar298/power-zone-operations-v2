import {Button} from '../ui/Button.js';
import {navigateInventory} from '../inventory-approved/navigation.js';
/** Retired UI only: old bookmarks cannot open the former manual-entry forms. */
export function DispatchReconciliationPage(){
 return <section className="pz-panel pz-stack"><h1>This reconciliation page has been archived</h1><p>Saved dispatches, signed documents, returns and ledger history are preserved.</p><Button variant="secondary" onClick={()=>navigateInventory('/inventory')}>Back to Inventory</Button></section>;
}
