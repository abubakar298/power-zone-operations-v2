import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { jsPDF } from "jspdf";
import { actors, login } from "./release-fixtures.js";
import { ProjectWorkflowRepository } from "../../server/project-workflow/repository.js";
import { directPoSuggestions } from "../../shared/direct-po-reading.js";
test("UBL IPO keeps master NTN/STRN across confirmation changes and blank PO extraction, retaining manual corrections", async ({
  page,
}) => {
  await actors(page.request);
  await login(page.request, "coordinator-release@example.test");
  const fixture = JSON.parse(
    await readFile(
      `.local/e2e-fixture-${process.env.PZ_E2E_PORT ?? "3180"}.json`,
      "utf8",
    ),
  );
  expect(fixture.marker).toBe("power-zone-disposable-browser-fixture-v1");
  expect(new URL(fixture.databaseUrl).hostname).toBe("127.0.0.1");
  const pool = new pg.Pool({ connectionString: fixture.databaseUrl, max: 2 });
  try {
    await pool.query(
      "UPDATE customers SET ntn='1234567-8',strn='UBL-STRN-BROWSER' WHERE id=5",
    );
    const actor = (
        await pool.query(
          "SELECT id FROM users WHERE email='coordinator-release@example.test'",
        )
      ).rows[0].id,
      f = (
        await pool.query(
          "SELECT id FROM project_framework_current WHERE configuration_key='UBL-BESS-20-40'",
        )
      ).rows[0];
    const repo = new ProjectWorkflowRepository(pool),
      name = "UBL tax defaults fixture",
      record = await repo.create(actor, {
        requestKey: randomUUID(),
        customerId: 5,
        siteName: name,
        siteCode: "TAX-UBL",
        route: "direct-framework",
        frameworkId: f.id,
        notes: "Isolated IPO tax default proof",
      });
    const pdf = new jsPDF({ compress: true });
    pdf.text("Customer PO reference: TAX-PO", 20, 20);
    pdf.text("Branch code: TAX-UBL", 20, 30);
    pdf.text("Branch name: UBL tax defaults fixture", 20, 40);
    const buffer = Buffer.from(pdf.output("arraybuffer"));
    const file = await repo.attach(actor, record.id, {
      kind: "PO / confirmation",
      filename: "tax-test.pdf",
      mime: "application/pdf",
      base64: buffer.toString("base64"),
    });
    const values = {
      ...directPoSuggestions(""),
      siteCode: "TAX-UBL",
      siteName: name,
      approvalDate: "2026-11-06",
      poNumber: "TAX-PO",
      approvalSubject: "Customer PO",
    };
    await page.goto("/dashboard");
    await page
      .locator("tr")
      .filter({ hasText: name })
      .getByRole("button", { name: "Open site record", exact: true })
      .click();
    const type = page.getByLabel("Sale confirmation type", { exact: false });
    await type.selectOption("Customer PO");
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "tax-no-number.pdf",
        mimeType: "application/pdf",
        buffer,
      });
    await page
      .getByText("Edit customer & billing details", { exact: true })
      .click();
    const ntn = page.getByLabel("Customer NTN", { exact: true }),
      strn = page.getByLabel("Customer STRN", { exact: true });
    await expect(ntn).toHaveValue("1234567-8");
    await expect(strn).toHaveValue("UBL-STRN-BROWSER");
    await ntn.fill("MANUAL-NTN");
    await type.selectOption("WhatsApp approval");
    await type.selectOption("Customer PO");
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "tax-no-number.pdf",
        mimeType: "application/pdf",
        buffer,
      });
    await expect(ntn).toHaveValue("MANUAL-NTN");
    await expect(strn).toHaveValue("UBL-STRN-BROWSER");
    await expect(ntn).toBeEnabled();
    await page.screenshot({
      path: "../previews/ipo-tax-defaults.png",
      fullPage: true,
    });
  } finally {
    await pool.end();
  }
});
test("UBL customer PO selects a different approved configuration, previews its price and issues with a notification-only change", async ({
  page,
}) => {
  await actors(page.request);
  await login(page.request, "coordinator-release@example.test");
  const fixture = JSON.parse(
    await readFile(
      `.local/e2e-fixture-${process.env.PZ_E2E_PORT ?? "3180"}.json`,
      "utf8",
    ),
  );
  expect(fixture.marker).toBe("power-zone-disposable-browser-fixture-v1");
  expect(new URL(fixture.databaseUrl).hostname).toBe("127.0.0.1");
  const pool = new pg.Pool({ connectionString: fixture.databaseUrl, max: 2 });
  try {
    const actor = (
        await pool.query(
          "SELECT id FROM users WHERE email='coordinator-release@example.test'",
        )
      ).rows[0].id,
      source = (
        await pool.query(
          "SELECT id FROM project_framework_current WHERE configuration_key='UBL-BESS-20-40'",
        )
      ).rows[0],
      target = (
        await pool.query(
          "SELECT id FROM project_framework_current WHERE configuration_key='UBL-BESS-30-60'",
        )
      ).rows[0];
    const repo = new ProjectWorkflowRepository(pool),
      name = "Surveyed UBL configuration change fixture",
      record = await repo.create(actor, {
        requestKey: randomUUID(),
        customerId: 5,
        siteName: name,
        siteCode: "PO-CHANGE-UBL",
        route: "survey-framework",
        frameworkId: source.id,
        notes: "UI fixture; full survey lifecycle is verified in native tests",
      });
    // Set up the already-reviewed historical recommendation for this UI-only scenario.
    const r = (await repo.record(actor, record.id)).r;
    await pool.query(
      "UPDATE project_workflow_records SET stage='customer_tracking',data=$2 WHERE id=$1",
      [
        record.id,
        {
          ...r.data,
          designHandoffAt: "2026-11-06T00:00:00Z",
          technicalVerifiedAt: "2026-11-06T00:00:00Z",
          dispatchedAt: "2026-11-06T00:00:00Z",
        },
      ],
    );
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /^Customer Follow-up/ })
      .click();
    await page
      .getByRole("searchbox", { name: "Search customer follow-up" })
      .fill(name);
    await page
      .getByRole("row")
      .filter({ hasText: name })
      .getByRole("button", { name: "Confirm Sale", exact: true })
      .click();
    await page
      .getByLabel("Sale confirmation type", { exact: false })
      .selectOption("Customer PO");
    const changed = page.waitForResponse(
      (res) =>
        res.url().endsWith("/preview") &&
        res.request().postDataJSON()?.frameworkId === target.id,
    );
    await page
      .getByLabel("Configuration requested in customer PO", { exact: true })
      .selectOption(target.id);
    expect((await changed).ok()).toBe(true);
    await page
      .getByLabel("Customer configuration change reason", { exact: true })
      .fill("Customer requested the larger pre-agreed BESS option in its PO");
    const pdf = new jsPDF({ compress: true });
    pdf.text("Customer PO reference: UBL-CHANGE-PO", 20, 20);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "customer-change.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(pdf.output("arraybuffer")),
      });
    await page.getByLabel("Order date", { exact: true }).fill("2026-11-06");
    await page
      .getByLabel("PO Reference Number", { exact: true })
      .fill("UBL-CHANGE-PO");
    await page
      .getByLabel("Approval evidence / verbal confirmation details", {
        exact: true,
      })
      .fill("Customer PO confirms the selected approved agreement");
    await page.getByLabel("Invoice terms", { exact: true }).selectOption("completion");
    const preview = page.waitForResponse((res) =>
      res.url().endsWith("/sale-preview"),
    );
    await page
      .getByRole("button", { name: "Preview IPO & PT", exact: true })
      .click();
    expect((await preview).ok()).toBe(true);
    await expect(
      page.getByRole("img", { name: "Draft IPO · page 1", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("I reviewed the IPO and PT breakup for Accounts.", {
        exact: true,
      })
      .check();
    await page
      .getByLabel(
        "Customer approved this exact quotation or pre-agreed configuration.",
        { exact: true },
      )
      .check();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "../previews/ubl-customer-configuration-change.png",
      fullPage: true,
    });
    page.once("dialog", (d) => d.accept());
    const issued = page.waitForResponse(
      (res) =>
        res.url().endsWith("/actions") &&
        res.request().postDataJSON()?.action === "receipt",
    );
    await page
      .getByRole("button", { name: "Confirm Sale & Issue", exact: true })
      .click();
    expect((await issued).ok()).toBe(true);
    const final = (await repo.record(actor, record.id)).r;
    expect(final.stage).toBe("issued");
    await expect(page.getByRole("heading", { name: "Customer Follow-up", exact: true, level: 2 })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    expect(final.data.basis.order.allocation.total).toBe("6150000.00");
    expect(final.data.originalRecommendedConfiguration.source.id).toBe(
      source.id,
    );
    expect(
      (
        await pool.query(
          "SELECT count(*) FROM ubl_customer_configuration_changes WHERE record_id=$1",
          [record.id],
        )
      ).rows[0].count,
    ).toBe("1");
  } finally {
    await pool.end();
  }
});
