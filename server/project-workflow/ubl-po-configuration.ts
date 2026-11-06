import { Decimal } from "decimal.js";
import type { Pool, PoolClient } from "pg";
import { HttpError } from "../http/errors.js";
type Db = Pool | PoolClient;
export async function ublPoConfigurations(c: Db, r: any) {
  if (r.short_code !== "UBL" || r.route !== "survey-framework")
    throw new HttpError(
      422,
      "Customer-requested configuration selection applies to UBL pre-agreed surveys.",
    );
  return (
    await c.query(
      `SELECT id,configuration_key,version,payload->>'type' AS type,COALESCE(payload->>'label',configuration_key) AS label,COALESCE(payload#>>'{approved,total}',payload#>>'{commercial,totalIncludingGst}') AS total FROM project_framework_current WHERE customer_id=$1 AND payload->'routes' ? 'survey-framework' AND (payload->>'type'='ubl-bess-installation' OR (payload->>'type'='ubl-solar' AND payload->>'pricingStage'='Revised')) ORDER BY configuration_key`,
      [r.customer_id],
    )
  ).rows;
}
/** A customer-selected existing agreement needs notice, never a new pricing approval. */
export async function ublPoConfigurationChange(
  c: Db,
  r: any,
  received: any,
  basis: any,
) {
  const original = r.data.originalRecommendedConfiguration ?? r.data.basis;
  if (
    r.short_code !== "UBL" ||
    r.route !== "survey-framework" ||
    !original?.source ||
    original.source.id === basis.source.id
  )
    return null;
  if (!r.data.technicalVerifiedAt || !r.data.designHandoffAt)
    throw new HttpError(
      422,
      "Complete the survey technical review and recommendation before recording a customer configuration change.",
    );
  if (received.confirmationType !== "Customer PO")
    throw new HttpError(
      422,
      "Attach the customer PO for a customer-requested configuration change.",
    );
  if (!(await ublPoConfigurations(c, r)).some((f) => f.id === basis.source.id))
    throw new HttpError(
      422,
      "Select a current approved UBL configuration. Other scope or price changes require the existing approval route.",
    );
  if (!received.configurationChangeReason?.trim())
    throw new HttpError(
      422,
      "Record why the customer PO requests a different approved configuration.",
    );
  return {
    recommended: { source: original.source, total: original.comparison.total },
    ordered: { source: basis.source, total: basis.comparison.total },
    sellingDifference: new Decimal(basis.comparison.total)
      .sub(original.comparison.total)
      .toFixed(2),
    reason: received.configurationChangeReason.trim(),
    poReference: received.reference,
    notificationOnly: true,
    requiresNewApproval: false,
  };
}
