import { test, expect } from "@playwright/test";
test("Inventory workspace: job search, draft, attachment, reconciliation and immutable Accounts handoff", async ({
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
  await page
    .getByRole("button", { name: "Inventory workspace", exact: true })
    .click();
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
    page.getByRole("cell", { name: "CHP-320", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enter installation report", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /CHP-320 · Adda Jahan/ }),
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
  await page
    .getByLabel("DC red + black 6mm² combined installed quantity", {
      exact: true,
    })
    .fill("190");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Report saved");
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
    page.getByRole("cell", { name: "40,785.88", exact: true }),
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
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Send to Accounts", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Sent to Accounts");
  await expect(
    page.getByRole("button", { name: "Edit entry", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: "Inventory workspace", exact: true }).click();
  await page
    .getByRole("button", { name: "Receipts & Reconciliation", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Sent to Accounts", exact: true }),
  ).toBeVisible();
});
