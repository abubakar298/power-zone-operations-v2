import type {Pool,PoolClient} from 'pg';
/** The dedicated C&I offer is one 125 kW / 261 kWh cabinet, not its service parts. */
export const CNI_COMMERCIAL_ITEM_ID='CH-CNI-125-261';
export async function cniCommercialItem(client:Pool|PoolClient){
 const row=(await client.query("SELECT item_id,version,payload->>'commercialDescription' AS description FROM inventory_catalogue_current WHERE item_id=$1",[CNI_COMMERCIAL_ITEM_ID])).rows[0];
 return row?.description?.trim()?{itemId:row.item_id,version:row.version,description:row.description.trim()}:undefined;
}
