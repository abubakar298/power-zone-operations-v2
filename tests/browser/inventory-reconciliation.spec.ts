import {openWorkspaceSection} from './navigation.js';
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import pg from "pg";
test("Inventory workspace: job search, draft, attachment, immutable handoff and QC-gated Accounts closure", async ({
  page,
  request,
}) => {
  const origin = "http://127.0.0.1:" + (process.env.PZ_E2E_PORT ?? "3180");
  const credentials = {
    email: "inventory-pilot@example.test",
    displayName: "Inventory Pilot",
    password: "isolated-browser-password-298",
    setupToken: "browser-test-setup-key-isolated-only",
  };
  expect(
    (
      await request.post("/api/auth/setup", {
        headers: { Origin: origin },
        data: credentials,
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await openWorkspaceSection(page, 'Inventory workspace');
  await expect(
    page.getByRole("heading", { name: "My Workspace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Receipts & Reconciliation", exact: true })
    .click();
  await page
    .getByLabel("Search Job ID or site", { exact: true })
    .fill("CHP-320");
  await expect(
    page.getByRole("cell", { name: /^CHP-320 .*Adda Jahan/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enter installation report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /CHP-320.*Adda Jahan/ }),
  ).toBeVisible();
  await page
    .getByLabel("Installation start", { exact: true })
    .fill("2026-10-01");
  await page
    .getByLabel("Installation completion", { exact: true })
    .fill("2026-10-02");
  await page.getByLabel("Installed panel quantity", { exact: true }).fill("55");
  await page.getByLabel("Watts per panel", { exact: true }).fill("645");
  for (const input of await page
    .locator(".pz-inventory tbody input[type=number]")
    .all())
    await input.fill("0");
  await page
    .getByLabel("16mm² 4C inverter cable installed quantity", { exact: true })
    .fill("13");
  await page.getByLabel('DC cable red 6mm² installed quantity',{exact:true}).fill('95');
  await page.getByLabel('DC cable black 6mm² installed quantity',{exact:true}).fill('95');
  await page
    .getByLabel("Installation report / evidence", { exact: true })
    .setInputFiles({
      name: "IRR-pilot.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nPilot attachment"),
    });
  await expect(page.getByRole("status")).toContainText("Attachment saved");
  await page
    .getByRole("button", { name: "Create reconciliation report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cable reconciliation · MTRS" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Rate without GST" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("row", { name: "16mm² 4C inverter cable MTRS 10.00 13.00 3.00 3,220.00 9,660.00", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/inventory-reconciliation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/inventory-reconciliation-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Send to Accounts", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Send reconciliation to Accounts", exact: true })
    .getByRole("button", { name: "Send reconciliation to Accounts", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sent to Accounts");
  await expect(
    page.getByRole("button", { name: "Edit entry", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await openWorkspaceSection(page, 'Inventory workspace');
  await page
    .getByRole("button", { name: "Receipts & Reconciliation", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Sent to Accounts", exact: true }),
  ).toBeVisible();
  await openWorkspaceSection(page, 'Accounts workspace');
  await page.getByRole("button", { name: "Enter approved documents in PT", exact: true }).click();
  await page.getByRole("button", { name: "Record PT entry", exact: true }).click();
  await page.getByLabel("PT reference (required)", { exact: true }).fill("PT-BROWSER-IRR-320");
  await page.getByLabel("Entry date (required)", { exact: true }).fill("2026-10-02");
  await page.getByRole("button", { name: "Save PT entry & Prepare Job Closure", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("PT entry recorded");
  await expect(page.getByRole("heading", { name: /CHP-320/ })).toBeVisible();
  // First opening also verifies that redacted budget values render safely.
  // Give only this disposable costing actor the same explicit capability as
  // the native closure tests before testing persisted actual-cost submission.
  const port=process.env.PZ_E2E_PORT??'3180';
  const fixture=JSON.parse(await readFile(`.local/e2e-fixture-${port}.json`,'utf8'));
  const control=JSON.parse(await readFile(`.local/e2e-control-${port}.json`,'utf8'));
  const database=new URL(fixture.databaseUrl);
  if(fixture.marker!=='power-zone-disposable-browser-fixture-v1'||fixture.pid!==control.pid||database.hostname!=='127.0.0.1'||database.pathname!=='/power_zone_test'||database.username!=='postgres')throw Error('Owned disposable costing fixture required.');
  const pool=new pg.Pool({connectionString:fixture.databaseUrl,max:1});
  try{
    const current=(await pool.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")).rows[0];
    if(current.name!=='power_zone_test'||!/[\\/]pz-v2-test-[^\\/]+[\\/]db$/.test(current.directory))throw Error('Owned disposable database directory required.');
    const granted=await pool.query("INSERT INTO restricted_cost_access(user_id,granted_reason) SELECT id,'Explicit isolated browser closure costing capability' FROM users WHERE email='inventory-pilot@example.test' AND role='Admin' AND active ON CONFLICT(user_id) DO NOTHING RETURNING user_id");
    expect(granted.rowCount).toBe(1);
  }finally{await pool.end();}
  for (const phase of [
    "Solar Panels",
    "Structure",
    "Inverter",
    "Batteries",
    "BMS",
  ])
    await page.getByLabel(phase + " actual cost", { exact: true }).fill("1000");
  await page.getByLabel("EPC actual cost", { exact: true }).fill("4000");
  await page
    .getByLabel("Enter EPC actual cost details", { exact: true })
    .check();
  await expect(page.getByRole("alert")).toContainText("EPC detail must match");
  await page
    .getByLabel("Enter EPC actual cost details", { exact: true })
    .uncheck();
  await expect(
    page.getByRole("heading", {
      name: "Potential cable invoice adjustment impact · excluding GST",
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Client acknowledgment reference',{exact:true})).toHaveCount(0);
  await expect(page.locator('p').filter({hasText:'Not received'})).toHaveCount(2);
  await page.locator('#closure-pt-upload').setInputFiles({name:'pt-costing.png',mimeType:'image/png',buffer:await page.screenshot()});
  await expect(page.getByText('pt-costing.png',{exact:true}).first()).toBeVisible();
  await page.getByLabel('Accounts remarks / cost variance explanation',{exact:true}).fill('Isolated browser fixture; awaiting QC evidence.');
  await page.getByRole('button',{name:'Save closure draft',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Closure draft saved'})).toBeVisible();
  // Accounts cannot manufacture QC evidence by entering a free-text reference.
  // Native closure tests cover submission/approval with separately supplied QC files.
  await page.getByRole('button',{name:'Submit closure to Management',exact:true}).click();
  await page.getByRole('dialog',{name:'Submit closure to Management',exact:true})
    .getByRole('button',{name:'Submit closure to Management',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('await client acknowledgment and site photographs from QC');
  await expect(page.getByRole('button',{name:'Save closure draft',exact:true})).toBeEnabled();
});
