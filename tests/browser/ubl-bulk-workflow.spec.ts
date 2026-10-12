import { test, expect } from "@playwright/test";
test("Reviewed UBL batch imports once, retains survey stage and exposes evidence-aware site controls", async ({
  page,
}) => {
  page.on("dialog", (d) => d.accept());
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
  const setup = await page.request.post("/api/auth/setup", {
    headers: { Origin: origin },
    data: {
      email: "ubl-import-admin@example.test",
      displayName: "UBL import admin",
      password: "browser-test-passphrase-298",
      setupToken: "browser-test-setup-key-isolated-only",
    },
  });
  expect(setup.status()).toBe(201);
  await page.goto("/login");
  await page.getByLabel("Email address").fill("ubl-import-admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-passphrase-298");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "UBL Site Workflow", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import reviewed 36-site batch", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Reviewed UBL source imported" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Import reviewed 36-site batch",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator("table tbody tr")).toHaveCount(36);
  await page
    .getByLabel("Search site, branch, job ID or configuration")
    .fill("2496");
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await expect(page.locator("table tbody tr")).toContainText("In progress");
  await page.getByRole("button", { name: "Open site", exact: true }).click();
  await expect(page.getByLabel("Survey stage")).toHaveValue("In progress");
  await expect(page.getByLabel("Configuration recommendation")).toHaveValue("");
  await page
    .getByLabel("Survey findings and the configuration have been reviewed")
    .check();
  await page
    .getByRole("button", { name: "Verify recommendation", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "Upload the survey report before technical verification",
      }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Survey intake · version 1" }).click();
  expect((await download).suggestedFilename()).toContain(
    "UBL-2496-Survey-intake",
  );
  await page
    .getByRole("button", { name: "Back to UBL workflow", exact: false })
    .click();
  await page
    .getByLabel("Search site, branch, job ID or configuration")
    .fill("2756");
  await expect(page.locator("table tbody tr")).toContainText(
    "Installation reportedly nearing completion",
  );
  await page.getByLabel("Search site, branch, job ID or configuration").fill("1967");
  await page.getByRole("button", {name:"Open site",exact:true}).click();
  await page.getByRole("button", {name:"Send review-only IPO / PT sample to Accounts",exact:true}).click();
  await expect(page.getByRole("link",{name:"IPO / PT review sample · version 1"})).toBeVisible();
  await page.getByRole("button", {name:"Accounts workspace",exact:true}).click();
  await page.getByRole("button", {name:"IPOs to review 1",exact:true}).click();
  await page.getByRole("button", {name:"Review IPO & PT",exact:true}).click();
  await expect(page.getByRole("img",{name:"IPO and PT · page 1"})).toBeVisible();
  await page.getByLabel("Accounts review remarks / revision reason").fill("Review sample layout accepted");
  await page.getByRole("button",{name:"Approve IPO",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Approved sample"})).toBeVisible();
  await page.getByRole("button",{name:"UBL Site Workflow",exact:true}).click();
  await expect(page.getByRole("button",{name:"Heads-up Received—Preparation Pending 10",exact:true})).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Search site, branch, job ID or configuration")
    .fill("");
  await expect(
    page.getByRole("button", { name: "Open site", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "output/ubl-workflow-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "output/ubl-workflow-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("table tbody tr")).toHaveCount(36);
});
