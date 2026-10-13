import type { Pool } from "pg";
import { Decimal } from "decimal.js";
import { quote, discountedSellingReview } from "../commercial/engine.js";
import { managementReview } from "../commercial/management-review.js";

export function savedQuotationMarkup(pricing:any, boq:any, quotation:any) {
  const extra=quotation.additionalItem;
  if(pricing.input.discountPercent!==undefined && !extra){
    const review=discountedSellingReview(pricing,quotation.input.discount??pricing.discount);
    const cost=new Decimal(pricing.cost);
    return cost.isZero()?null:new Decimal(review.subtotal).sub(cost).div(cost).mul(100).toFixed(2);
  }
  const detailed=quote({...pricing,input:{...pricing.input,presentation:"Full Breakup",taxMode:"Show Sales Tax Separately"}},boq,{...quotation.input,pricingId:"00000000-0000-4000-8000-000000000001",discount:"0",additionalItem:extra});
  const rows=boq.survey.family === "direct-product" && pricing.itemPricing ? pricing.itemPricing.map((l:any)=>{const source=boq.lines.find((x:any)=>x.key===l.key);return {description:source.description,qty:source.qty,unit:source.unit,group:l.group,beforeTax:l.beforeTax,taxRate:l.taxRate};}) : detailed.lines.map((l:any,i:number)=>({description:l.description,qty:l.qty,unit:l.unit,group:l.group,beforeTax:l.amount,taxRate:extra&&i===detailed.lines.length-1?extra.taxRate:pricing.rows.find((r:any)=>r.key===l.group).taxRate}));
  const amount=(label:string)=>detailed.footer.find((r:any)=>r.label===label)?.amount ?? "0.00";
  return managementReview(rows,amount("Subtotal Before Tax"),amount("SOLAR PANEL SALES TAX @10%"),amount("SALES TAX ON OTHER ITEMS @18%"),new Decimal(pricing.cost).add(extra?.cost??"0").toString(),quotation.input.discount??"0",{discount:quotation.input.discount??"0"}).original.profitPercent;
}

// Read only frozen document snapshots; current master values never alter history.
export async function workflowHistory(pool: Pool, revisionId: string) {
  const history = (
    await pool.query(
      `WITH RECURSIVE lineage AS (
            SELECT b.*,ARRAY[b.id] AS visited FROM boq_revisions b WHERE b.id=$1
            UNION ALL
            SELECT b.*,l.visited || b.id FROM lineage l
            JOIN boq_draft_finalizations f ON f.revision_id=l.id
            JOIN survey_drafts d ON d.id=f.draft_id
            JOIN boq_revisions b ON b.id=d.base_revision_id
            WHERE NOT b.id=ANY(l.visited)
          ) SELECT l.id,l.number,l.revision,l.created_at,l.revision_reason,l.revision_origin,
            l.snapshot->>'total' AS budgeted_cost,l.snapshot AS private_boq,
            COALESCE(l.snapshot->'survey'->>'sourceMode','Survey') AS survey_type,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id',q.id,'number',q.number,'quoted_at',q.created_at,
              'private_quote',q.snapshot || jsonb_build_object('additionalItem',(SELECT a.input FROM quotation_additional_inputs a WHERE a.quotation_id=q.id)),'private_pricing',(SELECT p.snapshot FROM commercial_pricing_versions p WHERE p.id=q.pricing_id),
              'revision',(SELECT jsonb_build_object('origin',r.origin,'reason',r.reason) FROM quotation_revision_links k JOIN quotation_revision_requests r ON r.id=k.request_id WHERE k.quotation_id=q.id),
              'net_total',(SELECT entry->>'amount' FROM jsonb_array_elements(q.snapshot->'footer') entry WHERE entry->>'label'='Net Total' LIMIT 1),
              'status',COALESCE((SELECT e.kind FROM coordination_events e WHERE e.quotation_id=q.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1),'Not submitted')
            ) ORDER BY q.version) FROM quotation_versions q WHERE q.boq_revision_id=l.id),'[]'::jsonb) AS quotations
          FROM lineage l ORDER BY l.revision,l.created_at`,
      [revisionId],
    )
  ).rows;
  let previousSettings:any=null;
  for(const b of history){
    for(const q of b.quotations){
      q.quotation_type=q.private_pricing?.input ? `${q.private_pricing.input.presentation} · ${q.private_pricing.input.taxMode}` : null;
      q.quotation_settings=q.private_pricing?.input ? {presentation:q.private_pricing.input.presentation,taxMode:q.private_pricing.input.taxMode} : null;
      q.budgeted_markup=q.private_pricing?savedQuotationMarkup(q.private_pricing,b.private_boq,q.private_quote):null;
      q.settings_changes=[];
      if(previousSettings && q.quotation_settings){
        for(const [key,label] of [["presentation","Price presentation"],["taxMode","Tax presentation"]]){
          if(previousSettings[key]!==q.quotation_settings[key]) q.settings_changes.push(`${label}: ${previousSettings[key]} → ${q.quotation_settings[key]}`);
        }
      }
      if(q.quotation_settings) previousSettings=q.quotation_settings;
      delete q.private_quote;delete q.private_pricing;
    }
    delete b.private_boq;
  }
  return history;
}
