import type { Pool } from "pg";
import { Decimal } from "decimal.js";
import { OrdersRepository } from "../orders/repository.js";
import { orderSchema } from "../orders/schema.js";
import { HttpError } from "../http/errors.js";
import type { BoqSnapshot } from "../boq/engine.js";
const names = [
  "Solar Panels",
  "Structure",
  "Inverter",
  "Batteries",
  "BMS",
  "EPC",
];
const money = (v: Decimal) =>
  v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export function phaseBudgets(
  snapshot: BoqSnapshot,
  selling: { name: string; amount: string }[] = [],
  additionalCost = "0",
) {
  const costs = names.map(() => new Decimal(0));
  for (const line of snapshot.lines) {
    const phase =
      line.phase === "Solar Panels"
        ? 0
        : line.phase === "Structure"
          ? 1
          : line.key === snapshot.inverterConfig.sku
            ? 2
            : line.key === "CH-BMS-HV"
              ? 4
              : line.phase === "BESS"
                ? 3
                : 5;
    costs[phase] = costs[phase].add(line.total);
  }
  costs[5] = costs[5].add(additionalCost);
  // Allocate the report's rounding cents to the largest fractional remainders.
  // This conserves total cost without creating a negative phase for a zero-cost EPC.
  const rawCents = costs.map((v) => v.mul(100));
  const target = rawCents
    .reduce((sum, v) => sum.add(v), new Decimal(0))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const cents = rawCents.map((v) => v.floor());
  const remainder = target
    .minus(cents.reduce((sum, v) => sum.add(v), new Decimal(0)))
    .toNumber();
  const order = rawCents
    .map((v, i) => ({ i, remainder: v.minus(cents[i]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i);
  for (let i = 0; i < remainder; i++)
    cents[order[i].i] = cents[order[i].i].add(1);
  for (let i = 0; i < costs.length; i++) costs[i] = cents[i].div(100);
  return names.map((name, i) => {
    const sale = selling.find((s) => s.name === name)?.amount;
    const profit =
      sale === undefined ? null : new Decimal(sale).minus(costs[i]);
    return {
      name,
      budgetedCost: money(costs[i]),
      sellingAmount: sale ?? null,
      budgetedProfit: profit === null ? null : money(profit),
      budgetedMarginPercent:
        sale && new Decimal(sale).gt(0)
          ? profit!.div(sale).mul(100).toFixed(2)
          : null,
      actualCost: null,
      actualProfit: null,
      marginVariance: null,
    };
  });
}
export class DirectorRepository {
  constructor(private pool: Pool) {}
  async portfolio(actor: string, customerId?: number) {
    const user = (
      await this.pool.query("SELECT active,role FROM users WHERE id=$1", [
        actor,
      ])
    ).rows[0];
    if (!user?.active || !["Admin", "Management"].includes(user.role))
      throw new HttpError(
        403,
        "Director reporting requires management access.",
      );
    const customers = (
      await this.pool.query(
        "SELECT id,name,short_code FROM customers WHERE status='Active' ORDER BY name",
      )
    ).rows;
    const records = (
      await this.pool.query(
        `SELECT b.id AS boq_id,b.site_id,b.customer_id,c.name AS customer,s.name AS site_name,r.id AS revision_id,r.number,r.snapshot,q.id AS quotation_id,q.number AS quotation_number,q.created_at AS quotation_date,q.snapshot AS quotation_snapshot,q.boq_revision_id AS quoted_revision_id,p.snapshot AS pricing_snapshot,extra.input AS additional_input,ipo.number AS ipo_number,ipo.snapshot AS ipo_snapshot FROM boqs b JOIN customers c ON c.id=b.customer_id JOIN sites s ON s.id=b.site_id JOIN LATERAL(SELECT * FROM boq_revisions WHERE boq_id=b.id ORDER BY revision DESC LIMIT 1)r ON true LEFT JOIN LATERAL(SELECT q.* FROM quotation_versions q JOIN boq_revisions br ON br.id=q.boq_revision_id WHERE br.boq_id=b.id ORDER BY q.created_at DESC,q.version DESC LIMIT 1)q ON true LEFT JOIN commercial_pricing_versions p ON p.id=q.pricing_id LEFT JOIN quotation_additional_inputs extra ON extra.quotation_id=q.id LEFT JOIN LATERAL(SELECT i.* FROM internal_purchase_orders i JOIN customer_purchase_orders po ON po.id=i.customer_po_id WHERE po.quotation_id=q.id ORDER BY i.created_at DESC LIMIT 1)ipo ON true WHERE ($1::integer IS NULL OR b.customer_id=$1) ORDER BY b.created_at DESC LIMIT 250`,
        [customerId ?? null],
      )
    ).rows;
    const orders = new OrdersRepository(this.pool);
    const proposals = [];
    for (const r of records) {
      let costing: BoqSnapshot = r.snapshot;
      let costingNumber = r.number;
      let division = r.ipo_snapshot?.peachtree;
      if (r.quotation_id) {
        const quoted = (
          await this.pool.query(
            "SELECT snapshot,number FROM boq_revisions WHERE id=$1",
            [r.quoted_revision_id],
          )
        ).rows[0];
        costing = quoted.snapshot;
        costingNumber = quoted.number;
        if (!division)
          division = (
            await orders.preview(
              actor,
              orderSchema.parse({
                quotationId: r.quotation_id,
                evidenceType: "Written approval",
                evidenceNotes: "Read-only reporting calculation",
                orderDate: r.quotation_snapshot.input.quotedDate,
                invoiceCompany: r.customer,
                salesPerson: r.quotation_snapshot.input.proposedBy,
                customerAccepted: true,
              }),
            )
          ).snapshot.peachtree;
      }
      const phases = phaseBudgets(
        costing,
        division?.phases,
        r.additional_input?.cost ?? "0",
      );
      const cost = money(
        phases.reduce((sum, p) => sum.add(p.budgetedCost), new Decimal(0)),
      );
      const revenue = division?.phaseTotal ?? null;
      proposals.push({
        id: r.boq_id,
        siteId: r.site_id,
        customerId: r.customer_id,
        customer: r.customer,
        site: costing.survey.siteName,
        siteCode: costing.survey.siteCode,
        boqNumber: costingNumber,
        boqRevisionId: r.quoted_revision_id ?? r.revision_id,
        quotationId: r.quotation_id,
        quotationNumber: r.quotation_number,
        ipoNumber: r.ipo_number,
        budgetedCost: cost,
        sellingRevenue: revenue,
        customerPayable: division?.ipoPayable ?? null,
        basis: division?.basis ?? "Quotation not prepared",
        budgetedProfit:
          revenue === null ? null : money(new Decimal(revenue).minus(cost)),
        phases,
      });
    }
    return {
      customers,
      proposals,
      recordLimit: 250,
      totals: {
        budgetedCost: money(
          proposals.reduce((sum, p) => sum.add(p.budgetedCost), new Decimal(0)),
        ),
        sellingRevenue: money(
          proposals.reduce(
            (sum, p) => sum.add(p.sellingRevenue ?? 0),
            new Decimal(0),
          ),
        ),
        pricedProposals: proposals.filter((p) => p.sellingRevenue !== null)
          .length,
        unpricedProposals: proposals.filter((p) => p.sellingRevenue === null)
          .length,
      },
      closingRequests: [],
      actualCostsConnected: false,
    };
  }
}
