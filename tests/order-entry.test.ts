import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./database.js";
import { createDashboardSamples } from "../server/coordinator/samples.js";
import { OrdersRepository } from "../server/orders/repository.js";
import { OperationsRepository } from "../server/operations/repository.js";
import { poSuggestions } from "../server/orders/po-extraction.js";
import { orderSchema, orderBasisInputSchema } from "../server/orders/schema.js";
import { hashPassword } from "../server/auth/crypto.js";

test("PO extraction accepts unique labelled values, rejects ambiguous and invalid dates", () => {
  assert.deepEqual(
    poSuggestions(
      "PO Number: PO-27\nPO Date: 2026-10-06\nNTN: 1234567-8\nSTRN: 001234\nBilling address: 4 Main Road",
    ),
    {
      poNumber: "PO-27",
      orderDate: "2026-10-06",
      customerNtn: "1234567-8",
      customerStrn: "001234",
      billingAddress: "4 Main Road",
    },
  );
  assert.equal(poSuggestions("Date: 6 October 2026").orderDate, "2026-10-06");
  assert.deepEqual(
    poSuggestions(
      "Date: 06/10/2026\nNTN: 111\nNTN: 222\nPO number: A\nPO number: B",
    ),
    {},
  );
  assert.deepEqual(poSuggestions("Date: 2026-02-30\nDate: 2026-10-01"), {});
  assert.deepEqual(poSuggestions("Date: 2026-02-30"), {});
});

test("new IPO entry excludes delivery fields and tax IDs without an uploaded PO; legacy input still parses", () => {
  const base = {
    quotationId: randomUUID(),
    evidenceType: "Verbal sale confirmation",
    evidenceNotes: "Sale confirmed",
    orderDate: "2026-10-06",
    invoiceCompany: "PZES",
    salesPerson: "Salesperson",
    customerAccepted: true,
  };
  assert.ok(orderSchema.safeParse({ ...base, entryVersion: 2 }).success);
  assert.ok(
    !orderSchema.safeParse({
      ...base,
      entryVersion: 2,
      deliveryAddress: "Site",
    }).success,
  );
  assert.ok(
    !orderSchema.safeParse({ ...base, entryVersion: 2, customerNtn: "123" })
      .success,
  );
  assert.ok(
    orderSchema.safeParse({
      ...base,
      entryVersion: 2,
      evidenceType: "Customer PO",
      poNumber: "PO1",
      documentId: randomUUID(),
      customerNtn: "123",
    }).success,
  );
  assert.ok(
    orderSchema.safeParse({ ...base, deliveryAddress: "Legacy address" })
      .success,
  );
});

test("IPO defaults use current customer data and accepted quotation; Operations saves delivery independently with concurrency and immutable history", async () => {
  const db = await testDatabase();
  try {
    const owner = randomUUID(),
      manager = randomUUID(),
      password = await hashPassword("test-order-entry-password-298");
    for (const [id, role] of [
      [owner, "Coordinator"],
      [manager, "Admin"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, `${id}@example.test`, role, password, role],
      );
    const records = await createDashboardSamples(db.pool, owner, manager);
    const qRecord = records.find((r: any) => r.quotationId && r.stage===7)!;
    const orders = new OrdersRepository(db.pool);
    const before = (
      await db.pool.query(
        "SELECT id,snapshot FROM quotation_versions ORDER BY id",
      )
    ).rows;
    await db.pool.query(
      "UPDATE customers SET contact_person='Fresh contact',phone='03000000001',email='',address='Fresh billing address' WHERE id=(SELECT b.customer_id FROM quotation_versions q JOIN boq_revisions r ON r.id=q.boq_revision_id JOIN boqs b ON b.id=r.boq_id WHERE q.id=$1)",
      [qRecord.quotationId],
    );
    for(const record of records.filter((r:any)=>r.quotationId && [3,4,5].includes(r.stage))) {
      await assert.rejects(orders.defaults(record.quotationId), /approval is required/i);
    }
    const defaults = await orders.defaults(qRecord.quotationId);
    assert.equal(defaults.contactPerson, "Fresh contact");
    assert.equal(defaults.paymentContact, "Fresh contact");
    assert.equal(defaults.paymentPhone, defaults.phone);
    assert.equal(defaults.email, "");
    assert.equal(defaults.billingAddress, "Fresh billing address");
    assert.equal(defaults.salesPerson, "Atif Hameed (sample)");
    await assert.rejects(orders.defaults(randomUUID()), /not found/i);
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT id,snapshot FROM quotation_versions ORDER BY id",
        )
      ).rows,
      before,
    );
    const ops = new OperationsRepository(db.pool);
    const ipoRecord = records.find((r: any) => r.ipoId)!;
    const issued = await ops.issue(owner, {
      ipoId: ipoRecord.ipoId,
      notes: "Test handoff",
      requestKey: randomUUID(),
    });
    const ipoBefore = (
      await db.pool.query(
        "SELECT snapshot FROM internal_purchase_orders WHERE id=$1",
        [issued.ipo_id],
      )
    ).rows[0].snapshot;
    assert.equal(await ops.deliveryPlan(issued.id), null);
    const input = {
      version: 0,
      requestKey: randomUUID(),
      details: {
        deliveryAddress: "Operations site address",
        siteContact: "Site supervisor",
        sitePhone: "03001234567",
        deliveryDate: "2026-10-08",
        deliveryTime: "10:30",
        instructions: "Call before arriving",
      },
    };
    const plan = await ops.planDelivery(manager, issued.id, input);
    assert.equal(plan.version, 1);
    assert.equal(
      (await ops.planDelivery(manager, issued.id, input)).id,
      plan.id,
    );
    await assert.rejects(
      ops.planDelivery(manager, issued.id, {
        ...input,
        requestKey: randomUUID(),
      }),
      /changed/i,
    );
    await assert.rejects(
      ops.planDelivery(manager, issued.id, {
        ...input,
        details: { ...input.details, siteContact: "Different" },
      }),
      /already used/i,
    );
    const next = await ops.planDelivery(manager, issued.id, {
      ...input,
      version: 1,
      requestKey: randomUUID(),
      details: { ...input.details, deliveryTime: "14:00" },
    });
    assert.equal(next.version, 2);
    assert.equal(
      (await ops.deliveryPlan(issued.id)).details.deliveryTime,
      "14:00",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT details->>'deliveryTime' AS time FROM operations_delivery_plans WHERE id=$1",
          [plan.id],
        )
      ).rows[0].time,
      "10:30",
    );
    await assert.rejects(
      db.pool.query(
        "UPDATE operations_delivery_plans SET details='{}' WHERE id=$1",
        [plan.id],
      ),
      /immutable/i,
    );
    assert.deepEqual((await ops.get(issued.id)).snapshot, issued.snapshot);
    assert.deepEqual(
      (
        await db.pool.query(
          "SELECT snapshot FROM internal_purchase_orders WHERE id=$1",
          [issued.ipo_id],
        )
      ).rows[0].snapshot,
      ipoBefore,
    );
    await db.pool.query("UPDATE users SET active=false WHERE id=$1", [manager]);
    await assert.rejects(
      ops.planDelivery(manager, issued.id, {
        ...input,
        version: 2,
        requestKey: randomUUID(),
      }),
      /access has ended/i,
    );
  } finally {
    await db.close();
  }
});

 test("commercial basis lookup allows a not-yet-entered PO reference but sale submission still requires it", () => {
 const input={quotationId:randomUUID(),evidenceType:"Customer PO",evidenceNotes:"Read-only basis",orderDate:"2026-10-14",invoiceCompany:"PZES",salesPerson:"Atif",customerAccepted:true};
 assert.equal(orderBasisInputSchema.safeParse(input).success,true);
 assert.equal(orderSchema.safeParse(input).success,false);
 assert.equal(orderSchema.safeParse({...input,poNumber:"PO-1"}).success,true);
 assert.equal(orderSchema.safeParse({...input,evidenceType:"WhatsApp approval"}).success,true);
 assert.equal(orderBasisInputSchema.safeParse({...input,entryVersion:2,customerNtn:"123"}).success,false);
 });
