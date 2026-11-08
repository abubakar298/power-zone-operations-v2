import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import { fingerprint } from "../boq/repository.js";
import { requireUnarchivedQuotation } from "../commercial/archives.js";
import { CNI_COMMERCIAL_ITEM_ID } from "../commercial/cni-commercial-description.js";
import { HttpError } from "../http/errors.js";
import { commercialComparison } from "./policy.js";

export async function approvedCabinet(c: Pool | PoolClient, proposalId: string) {
  await requireUnarchivedQuotation(c, proposalId);
  const version = (await c.query(
    `SELECT v.*, p.created_by AS owner, p.customer_id, customer.name, customer.short_code,
            customer.ntn, customer.strn,
            (SELECT action FROM cni_proposal_actions WHERE version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1) AS action,
            EXISTS(SELECT 1 FROM quotation_dispatch_records WHERE cni_version_id=v.id) AS sent
       FROM cni_proposals p JOIN customers customer ON customer.id=p.customer_id AND customer.status='Active'
       JOIN LATERAL (SELECT * FROM cni_proposal_versions WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1) v ON true
      WHERE p.id=$1`, [proposalId],
  )).rows[0];
  if (!version) throw new HttpError(404, "Cabinet quotation not available.");
  if (version.action !== "Approved" || !version.sent)
    throw new HttpError(409, "Approve and send the latest cabinet quotation before confirming sale.");
  return version;
}

export async function cabinetBasis(c: Pool | PoolClient, record: any, expectedVersion?: string, lock = false) {
  const proposalId = record.data.cniProposalId;
  if (!proposalId) throw new HttpError(422, "No approved cabinet quotation is linked.");
  if (lock) await c.query("SELECT id FROM cni_proposals WHERE id=$1 FOR UPDATE", [proposalId]);
  const version = await approvedCabinet(c, proposalId);
  if (expectedVersion && version.id !== expectedVersion)
    throw new HttpError(409, "The cabinet quotation changed. Reopen Confirm Sale and review the latest approved version.");
  const { pricing, commercialItem } = version.snapshot;
  if (record.customer_id !== version.customer_id || record.site_code !== version.snapshot.siteCode)
    throw new HttpError(409, "The approved cabinet quotation and project site do not match.");
  const item = (await c.query(
    "SELECT item_id, version, payload FROM inventory_catalogue_current WHERE item_id=$1",
    [commercialItem?.itemId ?? CNI_COMMERCIAL_ITEM_ID],
  )).rows[0];
  if (!item) throw new HttpError(422, "The approved cabinet is missing its inventory item ID.");
  const description = commercialItem?.description || item.payload.commercialDescription || "125 kW / 261 kWh C&I BESS cabinet";
  const qty = String(pricing.quantity), unit = "No.";
  const cost = version.internal_cost_snapshot;
  if (!cost?.unitBeforeTax || !cost?.totalBeforeTax)
    throw new HttpError(422, "The approved cabinet quotation is missing its saved costing. Ask Management to review the quotation.");
  const customer = { id: version.customer_id, name: version.name, shortCode: version.short_code };
  const boq = {
    customer,
    survey: { customerId: customer.id, siteName: record.site_name, siteCode: record.site_code, family: "direct-product", panelQty: 0 },
    engineering: { pvWatts: "0" },
    lines: [{
      key: item.item_id, itemId: item.item_id, itemVersion: commercialItem?.version ?? item.version,
      description, specification: item.payload.technicalDescription || description,
      qty, unit, brand: item.payload.brandCategory || "Chint Power", phase: "BESS",
      rate: cost.unitBeforeTax, total: cost.totalBeforeTax,
    }],
    total: cost.totalBeforeTax,
  };
  const saleType = pricing.saleType ?? "Tax Deal";
  const taxMode = pricing.presentation === "Separate" ? "Show Sales Tax Separately" : "Tax Included";
  const phaseTotal = taxMode === "Tax Included" ? pricing.payable : pricing.beforeTax;
  const order = {
    source: "Approved C&I cabinet quotation", solutionId: "DIRECT-PRODUCT",
    cniProposalId: proposalId, cniVersionId: version.id,
    quotationId: null, quotationNumber: version.number, customer, siteName: record.site_name, siteCode: record.site_code,
    boqRevisionId: null, boqNumber: "Pending issuance",
    input: {
      invoiceCompany: saleType === "Cash Deal" ? "Energy Solutions" : "PZES (PVT Ltd)",
      customerNtn: version.ntn || "", customerStrn: version.strn || "", customerAccepted: true,
    },
    quotationType: { presentation: "Basic Breakup", taxMode, saleType, cashGstTreatment: pricing.cashGstTreatment },
    allocation: {
      policy: "approved-cni-cabinet", originalDiscount: pricing.discount ?? "0",
      subtotal: pricing.beforeTax, tax: pricing.tax, total: pricing.payable,
      lines: [{
        description, group: "other", qty, unit, rate: new Decimal(pricing.beforeTax).div(qty).toFixed(2),
        beforeTax: pricing.beforeTax, taxRate: saleType === "Cash Deal" ? "0" : pricing.taxRate,
        tax: pricing.tax, total: pricing.payable,
      }],
    },
    peachtree: {
      version: 2, presentation: "Basic Breakup", saleType, taxMode,
      basis: taxMode === "Tax Included" ? "Selling values including tax" : "Selling values excluding tax",
      policy: "approved-cni-cabinet", phases: [{ name: "BESS", amount: phaseTotal, description }],
      phaseTotal, ipoBeforeTax: pricing.beforeTax, ipoTax: pricing.tax, ipoPayable: pricing.payable,
    },
  };
  const comparison = commercialComparison(boq, order);
  return {
    source: { type: "cni", id: version.id, version: version.version, key: version.number },
    boq, order, comparison, fingerprint: fingerprint({ boq, order, comparison }),
  };
}
