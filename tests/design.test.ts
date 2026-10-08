import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { testDatabase } from "./database.js";
import { createApp } from "../server/app.js";
import { readConfig } from "../server/config.js";
import { hashPassword } from "../server/auth/crypto.js";
import { DesignRepository } from "../server/design/repository.js";
import { BoqRepository } from "../server/boq/repository.js";
import { MastersRepository } from "../server/masters/repository.js";
import { surveySchema } from "../server/boq/schema.js";
import { CoordinatorRepository } from "../server/coordinator/repository.js";

test("Design survey handoff freezes verified technical data, excludes brands and prices, and reaches only the assigned coordinator", async () => {
  const db = await testDatabase();
  try {
    const designer = randomUUID(),
      other = randomUUID(),
      coordinator = randomUUID(),
      admin = randomUUID(),
      password = "design-test-password-298",
      hash = await hashPassword(password);
    for (const [id, role] of [
      [designer, "Design"],
      [other, "Design"],
      [coordinator, "Coordinator"],
      [admin, "Admin"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$3)",
        [id, `${id}@example.test`, role, hash],
      );
    const origin = "http://localhost:3000",
      app = createApp(
        db.pool,
        readConfig({
          NODE_ENV: "test",
          DATABASE_URL: db.url,
          APP_ORIGIN: origin,
          ADMIN_SETUP_TOKEN: "design-test-setup-key-long-enough",
        }),
      ),
      agent = request.agent(app);
    const login = await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email: `${designer}@example.test`, password })
        .expect(200),
      csrf = login.body.csrfToken;
    for (const path of [
      "/api/masters",
      "/api/boqs",
      "/api/commercial/quotations",
      "/api/orders",
      "/api/coordinator",
      "/api/director",
      "/api/operations",
      "/api/departments/Accounts",
    ])
      await agent.get(path).expect(403);
    await request(app).get("/api/design").expect(401);
    await agent
      .post("/api/design")
      .set("Origin", origin)
      .send({ version: 0, inputs: {} })
      .expect(403);
    const refs = (await agent.get("/api/design/references").expect(200)).body;
    assert.ok(refs.customers.length);
    assert.ok(refs.inverters.length);
    assert.equal(refs.rates, undefined);
    assert.equal(refs.brands, undefined);
    const uploaded = (
      await agent
        .post("/api/survey-uploads")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrf)
        .send({
          filename: "physical-survey.pdf",
          mime: "application/pdf",
          base64: Buffer.from("%PDF-1.4\nphysical survey test").toString(
            "base64",
          ),
        })
        .expect(201)
    ).body;
    const repo = new DesignRepository(db.pool),
      boqs = new BoqRepository(db.pool);
    await assert.rejects(repo.list(coordinator), /Design access/);
    await agent
      .post("/api/design")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({ version: 0, inputs: { brands: { solar: 1 } } })
      .expect(400);
    const partial = await repo.save(designer, undefined, 0, {
      siteName: "Design sample",
      uploadIds: [],
    });
    await assert.rejects(repo.send(designer, partial.id, 1, coordinator));
    await assert.rejects(
      repo.save(other, partial.id, 1, { siteName: "Tamper" }),
      /not found/,
    );
    const inputs = {
      customerId: refs.customers[0].id,
      siteName: "Design sample",
      siteCode: "DSGN",
      location: "Test site",
      panelQty: 20,
      panelWattage: "620",
      structure: "L1",
      dcMetres: "100",
      earth25: "20",
      earth6: "30",
      earth10: "30",
      inverter: refs.inverters.find((i: any) => i.configuration === "10 kW")
        .configuration,
      batteryKwh: 15,
      smartMeter: false,
      genset: false,
      notes: "Roof route measured on site",
      uploadIds: [uploaded.id],
    };
    await assert.rejects(repo.save(other, undefined, 0, inputs), /own PDF/);
    const saved = await repo.save(designer, partial.id, 1, inputs);
    await assert.rejects(repo.save(designer, partial.id, 1, inputs), /changed/);
    await agent
      .post(`/api/design/${saved.id}/send`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({
        version: saved.version,
        coordinatorId: coordinator,
        verified: false,
      })
      .expect(400);
    await assert.rejects(
      repo.send(designer, saved.id, saved.version, other),
      /active coordinator/,
    );
    const [a, b] = await Promise.all([
      repo.send(designer, saved.id, saved.version, coordinator),
      repo.send(designer, saved.id, saved.version, coordinator),
    ]);
    assert.equal(a.draft_id, b.draft_id);
    await agent
      .post(`/api/design/${saved.id}/send`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .send({
        version: saved.version,
        coordinatorId: coordinator,
        verified: true,
      })
      .expect(201);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int AS n FROM design_survey_handoffs",
        )
      ).rows[0].n,
      1,
    );
    assert.equal((await repo.list(other)).length, 0);
    assert.equal((await repo.list(designer))[0].draft_id, a.draft_id);
    await assert.rejects(
      repo.save(designer, saved.id, saved.version, inputs),
      /changed or was sent/,
    );
    await assert.rejects(
      db.pool.query("UPDATE design_surveys SET inputs='{}' WHERE id=$1", [
        saved.id,
      ]),
      /immutable/,
    );
    await assert.rejects(
      db.pool.query("DELETE FROM design_survey_handoffs WHERE id=$1", [a.id]),
      /immutable/,
    );
    const draft = (await boqs.drafts(coordinator)).find(
      (d) => d.id === a.draft_id,
    );
    assert.ok(draft);
    assert.deepEqual(draft.inputs.brands, {});
    assert.equal(draft.inputs.panelQty, 20);
    assert.equal(draft.design_source.notes, inputs.notes);
    assert.equal(
      draft.design_source.attachments[0].filename,
      "physical-survey.pdf",
    );
    assert.ok(
      (
        await new CoordinatorRepository(db.pool).overview(coordinator, false)
      ).tasks.some(
        (t: any) => t.draft_id === draft.id && t.stage === "Survey & Costing Preparation",
      ),
    );
    assert.equal(
      (await boqs.attachment(coordinator, uploaded.id)).filename,
      "physical-survey.pdf",
    );
    await assert.rejects(boqs.attachment(other, uploaded.id), /not found/);
    await assert.rejects(repo.attachment(other, uploaded.id), /not found/);
    const masters = await new MastersRepository(db.pool).list();
    const categories = {
      solar: "Solar Panel",
      inverter: "Inverter",
      battery: "Battery & BMS",
      cable: "Cable",
      switchgear: "Switchgear",
    };
    const complete = surveySchema.parse({
      ...draft.inputs,
      ocrReviewed: true,
      brands: Object.fromEntries(
        Object.entries(categories).map(([k, category]) => [
          k,
          masters.brands.find(
            (b) => b.category === category && b.status === "Active",
          )!.id,
        ]),
      ),
    });
    const updated = await boqs.draft(
      coordinator,
      draft.id,
      draft.version,
      complete,
    );
    const preview = await boqs.preview(complete);
    const review = await boqs
      .reviews()
      .submit(coordinator, draft.id, updated.version, preview.fingerprint);
    assert.ok(review.id);
    assert.equal((await repo.list(designer))[0].inputs.panelQty, 20);
  } finally {
    await db.close();
  }
});
