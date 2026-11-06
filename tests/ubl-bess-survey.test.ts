import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  attachCustomerSendEvidence,
  sendPackageToCustomer,
} from "../server/project-workflow/ubl-customer-send.js";
import { NotificationsRepository } from "../server/notifications/repository.js";
import { frameworkBasis } from "../server/project-workflow/basis.js";
import { customerSurveyTemplates } from "../server/project-workflow/customer-survey-forms.js";
import { testDatabase } from "./database.js";
import { ProjectWorkflowRepository } from "../server/project-workflow/repository.js";
import {
  createConfigurationBatch,
  configurationBatchPreview,
} from "../server/project-workflow/configuration-batches.js";
import {
  createDispatch,
  previewDispatch,
  approveDispatch,
} from "../server/project-workflow/survey-dispatch.js";
test("individual and mixed solar/BESS survey assignment reuse dispatch, completion, technical and Management review without fresh quotation or repricing", async () => {
  const db = await testDatabase();
  try {
    const actor = randomUUID(),
      design = randomUUID(),
      manager = randomUUID();
    for (const [id, role] of [
      [actor, "Coordinator"],
      [design, "Design"],
      [manager, "Management"],
    ])
      await db.pool.query(
        "INSERT INTO users(id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$3)",
        [id, id + "@example.test", role, "unused"],
      );
    const repo = new ProjectWorkflowRepository(db.pool),
      keys = [
        "20-20-30:Revised",
        "UBL-BESS-20-40",
        "UBL-BESS-30-40",
        "UBL-BESS-30-60",
      ],
      frameworks = (
        await db.pool.query(
          "SELECT * FROM project_framework_current WHERE configuration_key=ANY($1)",
          [keys],
        )
      ).rows;
    const evidence = {
      filename: "survey-request.pdf",
      mime: "application/pdf",
      base64: Buffer.from(
        "%PDF-1.4\n% disposable survey evidence\n%%EOF",
      ).toString("base64"),
    };
    const individualIds = [];
    for (const [i, key] of keys.slice(1).entries()) {
      const individual = await repo.create(actor, {
        requestKey: randomUUID(),
        customerId: 5,
        siteName: "Individual BESS survey fixture " + key,
        siteCode: "IND-BESS-" + i,
        route: "survey-framework",
        notes: "Owner approved agreement, test fixture",
      });
      await repo.attach(actor, individual.id, {
        kind: "Request evidence",
        ...evidence,
      });
      individualIds.push(individual.id);
    }
    const batch = await createConfigurationBatch(db.pool, actor, {
      requestKey: randomUUID(),
      customerId: 5,
      route: "survey-framework",
      notes: "Mixed survey request fixture",
      rows: keys.map((key, i) => ({
        siteName: "Mixed survey fixture " + i,
        siteCode: "SUR-MIX-" + i,
      })),
      evidence,
    });
    const records = [
      ...individualIds,
      ...(
        await configurationBatchPreview(db.pool, actor, batch.id)
      ).records.map((r) => r.id),
    ];
    async function action(who: string, id: string, kind: string, input: any) {
      const { r } = await repo.record(who, id);
      return repo.action(who, id, {
        version: r.version,
        requestKey: randomUUID(),
        action: kind,
        input,
      });
    }
    for (const id of records) {
      const d = await repo.detail(actor, id);
      await action(actor, id, "send-design", {
        customerVerified: true,
        siteVerified: true,
        customerVersion: d.masterReview.customer.version,
        siteVersion: d.masterReview.site.version,
        notes: "Verified exact customer and site",
      });
      await action(design, id, "assign", {
        date: "2026-11-06",
        team: [design],
        technicalOwnerId: design,
        notes: "Scheduled survey fixture",
      });
    }
    const dispatch = await createDispatch(db.pool, design, {
        requestKey: randomUUID(),
      }),
      preview = await previewDispatch(db.pool, design, {
        dispatchId: dispatch.id,
        recordIds: records,
      });
    assert.equal(preview.sites.length, 7);
    await approveDispatch(db.pool, design, preview.id);
    const bessIds = [];
    for (const id of records) {
      const { r } = await repo.record(design, id);
      assert.equal(r.stage, "survey_scheduled");
      assert.equal(r.framework_id, null);
      assert.equal(r.data.basis, undefined);
      const chosenKey =
        records.indexOf(id) < 3
          ? keys[records.indexOf(id) + 1]
          : keys[records.indexOf(id) - 3];
      const selectedFramework = frameworks.find(
        (f) => f.configuration_key === chosenKey,
      );
      const fixtureBasis = await frameworkBasis(
        db.pool,
        db.pool,
        r,
        selectedFramework.id,
      );
      bessIds.push(id);
      await repo.attach(design, id, { kind: "Survey report", ...evidence });
      await repo.attach(design, id, {
        kind: "Survey photo",
        filename: "site.png",
        mime: "image/png",
        base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).toString(
          "base64",
        ),
      });
      const d = await repo.detail(design, id);
      const survey = {
        panelQty: 40,
        panelWattage: "500",
        structure: "Elevated",
        dcMetres: "100",
        acInverter16: "10",
        acPanel16: "20",
        earth25: "15",
        earth6: "60",
        earth10: "60",
        inverter: "20 kW",
        batteryKwh: 30,
        smartMeter: false,
        genset: true,
        family: "solar-hybrid",
        ...fixtureBasis.boq.survey,
      };
      delete survey.uploadIds;
      if (!fixtureBasis.boq.approvedAgreement) {
        survey.panelQty = 40;
        survey.panelWattage = "500";
      }
      const template = (await customerSurveyTemplates(db.pool)).find(
        (t) => t.key === "ubl-solar-survey",
      )!;
      const values = Object.fromEntries(
        template.payload.fields
          .filter((field: any) => !field.shared)
          .map((field: any) => [
            field.key,
            field.type === "load-table" ? [] : "N/A",
          ]),
      );
      await action(design, id, "save-survey-completion", {
        survey,
        customerForm: {
          templateKey: template.key,
          templateVersion: template.version,
          values,
        },
        masterDetails: {
          customerName: d.masterReview.customer.name,
          siteName: d.masterReview.site.name,
          address: d.masterReview.site.location ?? "",
        },
        confirmMasterChange: false,
        customerVersion: d.masterReview.customer.version,
        siteVersion: d.masterReview.site.version,
      });
      await action(design, id, "report", {
        date: "2026-11-06",
        notes: "Measured survey matches approved BESS scope",
      });
      await action(design, id, "begin-review", {
        technicalOwnerId: design,
        notes: "Start technical review",
      });
      await action(design, id, "review", {
        frameworkId: selectedFramework.id,
        profileKey: "standard-installation",
        profileVersion: 1,
        itemSelections: {},
        markups: {},
        notes: "Reviewed exact BESS installation scope",
      });
      const reviewed = (await repo.record(design, id)).r;
      assert.equal(reviewed.data.ublStandardsReview.needsReview, false);
      await action(design, id, "handoff", {
        notes:
          "Technically reviewed BESS configuration, no new pricing required",
      });
      const handed = (await repo.record(actor, id)).r;
      assert.equal(handed.stage, "design_handed_off");
      assert.equal(handed.framework_id, selectedFramework.id);
      assert.equal(handed.data.basis.fingerprint, fixtureBasis.fingerprint);
    }
    assert.equal(bessIds.length, 7);
    const pkg = await repo.saveUblSurveyPackage(actor, {
      requestKey: randomUUID(),
      recordIds: bessIds,
      submit: true,
      remarks: "Exact agreed BESS options in existing Management review",
    });
    assert("siteCount" in pkg);
    assert.equal(pkg.siteCount, 7);
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM quotation_versions")).rows[0]
        .count,
      "0",
    );
    const reviewed = await repo.decideUblSurveyPackage(manager, pkg.id, {
      requestKey: randomUUID(),
      decision: "Approved",
      notes: "Approved surveyed scope against frozen agreements",
      versions: await Promise.all(
        bessIds.map(async (id) => ({
          id,
          version: (await repo.record(manager, id)).r.version,
        })),
      ),
    });
    assert.equal(reviewed.siteCount, 7);
    for (const id of bessIds)
      assert.equal((await repo.record(actor, id)).r.stage, "approved_dispatch");
    await attachCustomerSendEvidence(repo, actor, pkg.id, evidence);
    await sendPackageToCustomer(repo, actor, pkg.id, {
      requestKey: randomUUID(),
      confirmed: true,
      recipient: "UBL test recipient",
      notes: "Recorded customer sending evidence, isolated fixture",
      versions: await Promise.all(
        bessIds.map(async (id) => ({
          id,
          version: (await repo.record(actor, id)).r.version,
        })),
      ),
    });
    for (const [i, id] of bessIds.entries()) {
      const r = (await repo.record(actor, id)).r;
      const file = await repo.attach(actor, id, {
        kind: "PO / confirmation",
        ...evidence,
      });
      const target =
        [0, 1, 3].includes(i)
          ? frameworks.find((f) => f.configuration_key === (i === 1 ? "20-20-30:Revised" : "UBL-BESS-30-60"))
          : null;
      const comparison = target
        ? (
            await repo.preview(actor, id, {
              kind: "framework",
              frameworkId: target.id,
            })
          ).comparison
        : r.data.basis.comparison;
      const received = {
        reference: "SURVEY-BESS-PO-" + i,
        date: "2026-11-06",
        evidenceId: file.id,
        basisType: "framework",
        frameworkId: target?.id ?? r.framework_id,
        confirmationType: "Customer PO",
        configurationChangeReason: target
          ? "Customer PO requested another existing approved Solar or BESS configuration"
          : "",
        actual: comparison,
        reviewed: true,
        notes: "Customer confirmed exact surveyed BESS agreement",
      };
      if (target) {
        await assert.rejects(
          repo.salePreview(actor, id, {
            ...received,
            configurationChangeReason: "",
          }),
          /why the customer PO/,
        );
        await assert.rejects(
          repo.salePreview(actor, id, {
            ...received,
            actual: { ...comparison, total: "1.00" },
          }),
          /Resolve PO differences/,
        );
        const before = (
          await db.pool.query("SELECT count(*) FROM project_order_decisions")
        ).rows[0].count;
        const preview = await repo.salePreview(actor, id, received);
        assert.equal(preview.allocation.total, comparison.total);
        assert.equal(
          (await db.pool.query("SELECT count(*) FROM project_order_decisions"))
            .rows[0].count,
          before,
        );
      }
      const command = {
        version: r.version,
        requestKey: randomUUID(),
        action: "receipt",
        input: received,
      };
      await repo.action(actor, id, command);
      await repo.action(actor, id, command);
      const after = (await repo.record(actor, id)).r;
      assert.equal(after.stage, "issued");
      if (target) {
        assert.equal(
          after.data.originalRecommendedConfiguration.source.id,
          r.data.basis.source.id,
        );
        assert.equal(after.data.basis.source.id, target.id);
        assert.equal(
          after.data.customerConfigurationChange.requiresNewApproval,
          false,
        );
      }
    }
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*) FROM ubl_customer_configuration_changes",
        )
      ).rows[0].count,
      "3",
    );
    await new NotificationsRepository(db.pool).sync();
    const notice = (
      await db.pool.query(
        "SELECT * FROM notifications WHERE user_id=$1 AND kind='UBL configuration changed'",
        [manager],
      )
    ).rows;
    assert.equal(notice.length, 3);
    assert.ok(notice.every(n => n.actionable === false));
    assert.ok(notice.some(n => /UBL-BESS-20-40.*UBL-BESS-30-60/.test(n.reference)));
    assert.ok(notice.some(n => /UBL-BESS-30-40.*20-20-30:Revised/.test(n.reference)));
    assert.ok(notice.some(n => /20-20-30:Revised.*UBL-BESS-30-60/.test(n.reference)));
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM ipo_accounts_handoffs"))
        .rows[0].count,
      "7",
    );
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM operations_boq_issuances"))
        .rows[0].count,
      "7",
    );
    assert.equal(
      (await db.pool.query("SELECT count(*) FROM quotation_versions")).rows[0]
        .count,
      "0",
    );
  } finally {
    await db.close();
  }
});
