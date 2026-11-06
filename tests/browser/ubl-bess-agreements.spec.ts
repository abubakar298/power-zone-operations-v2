import { test, expect } from "@playwright/test";
import { actors, login } from "./release-fixtures.js";
import { mkdir } from "node:fs/promises";
test("Atif selects frozen BESS agreements individually and issues mixed solar/BESS batch under one PO", async ({
  page,
}) => {
  await actors(page.request);
  const headers = await login(page.request, "coordinator-release@example.test");
  const refs = await (
    await page.request.get("/api/project-workflow/references")
  ).json();
  const keys = [
    "20-20-30:Revised",
    "UBL-BESS-20-40",
    "UBL-BESS-30-40",
    "UBL-BESS-30-60",
  ];
  const frameworks = keys.map((key) =>
    refs.frameworks.find((f: any) => f.configuration_key === key),
  );
  for (const f of frameworks) expect(f).toBeTruthy();
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Direct PO", exact: true })
    .first()
    .click();
  await page.getByLabel("Customer", { exact: true }).selectOption("5");
  for (const [i, f] of frameworks.slice(1).entries()) {
    await page
      .getByLabel("Accepted quotation", { exact: true })
      .selectOption(f.id);
    await expect(page.getByText(/Approved agreement:/)).toContainText(
      ["4,200,000.00", "4,670,000.00", "6,150,000.00"][i],
    );
  }
  await mkdir("../previews", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../previews/atif-individual-selection.png",
    fullPage: true,
  });
  expect(await page.getByText("2,895,000.00", { exact: false }).count()).toBe(
    0,
  );
  await page
    .getByRole("button", { name: "Enter a batch", exact: true })
    .click();
  await page
    .getByLabel("Customer PO number", { exact: true })
    .fill("BROWSER-MIXED-APPROVED-PO");
  await page.getByLabel("Customer PO date", { exact: true }).fill("2026-11-06");
  await page
    .getByLabel("Shared PO total including GST", { exact: true })
    .fill("20299116.00");
  await page
    .getByLabel("Original shared PO attachment", { exact: true })
    .setInputFiles({
      name: "test-po.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% disposable browser test\n%%EOF"),
    });
  for (const [i, f] of frameworks.entries()) {
    if (i)
      await page.getByRole("button", { name: "Add site", exact: true }).click();
    await page
      .getByLabel(`Site ${i + 1} name`, { exact: true })
      .fill("Browser approved mixed " + i);
    await page
      .getByLabel(`Site ${i + 1} address`, { exact: true })
      .fill("Isolated fixture Lahore");
    await page
      .getByLabel(`Site ${i + 1} branch code`, { exact: true })
      .fill("BROWSER-BESS-" + i);
    await page
      .getByLabel(`Site ${i + 1} configuration`, { exact: true })
      .selectOption(f.id);
  }
  await page
    .getByLabel("Original request / notes", { exact: true })
    .fill("Disposable mixed approved agreement browser proof");
  const primaryTops = await page
    .locator(".pz-configuration-batch tbody tr")
    .first()
    .locator('input[id^="batch-site-"],input[id^="batch-code-"],select')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top),
    );
  expect(Math.max(...primaryTops) - Math.min(...primaryTops)).toBeLessThan(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../previews/atif-mixed-batch-entry.png",
    fullPage: true,
  });
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/configuration-batches") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Prepare batch for review", exact: true })
    .click();
  const createdResponse = await created;
  expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
  const batch = await createdResponse.json();
  await expect(
    page.getByRole("heading", { name: "Review the saved batch", exact: true }),
  ).toBeVisible();
  const preview = page.waitForResponse((r) =>
    r.url().endsWith("/configuration-batches/" + batch.id + "/preview"),
  );
  await page
    .getByRole("button", { name: "Review IPO and PT documents", exact: true })
    .click();
  expect((await preview).ok()).toBe(true);
  await page
    .getByRole("button", { name: "Preview PT", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("img", { name: /Detailed PT.*page 1/ }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../previews/atif-batch-pt-preview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Close preview", exact: true })
    .click();
  await page.getByRole("checkbox").check();
  page.once("dialog", (dialog) => dialog.accept());
  const issued = page.waitForResponse((r) =>
    r.url().endsWith("/configuration-batches/" + batch.id + "/confirm"),
  );
  await page
    .getByRole("button", { name: "Issue batch IPOs and PT", exact: true })
    .click();
  expect((await issued).ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Batch issued", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.request
    .post(
      "/api/project-workflow/configuration-batches/" + batch.id + "/confirm",
      {
        headers,
        data: {
          requestKey: crypto.randomUUID(),
          fingerprint: "0".repeat(64),
          reviewed: true,
        },
      },
    )
    .then((r) => expect(r.status()).toBe(409));
});
test("Atif can create an individual BESS survey or mixed pre-agreed survey batch without entering quotation pricing", async ({
  page,
}) => {
  await actors(page.request);
  await login(page.request, "coordinator-release@example.test");
  const refs = await (
    await page.request.get("/api/project-workflow/references")
  ).json();
  await page.goto("/dashboard");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Survey Requests / })
    .click();
  await page
    .getByRole("button", { name: "Create survey request", exact: true })
    .click();
  await page.getByLabel("Customer", { exact: true }).selectOption("5");
  await page
    .getByLabel("Workflow route", { exact: true })
    .selectOption("survey-framework");
  await expect(
    page.getByLabel("Approved configuration and price version", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByLabel("Site name", { exact: true })
    .fill("Browser individual approved BESS survey");
  await page
    .getByLabel("Site / branch code", { exact: true })
    .fill("BROWSER-SURVEY-IND");
  await page
    .getByLabel("Site address", { exact: true })
    .fill("Isolated Lahore");
  await page
    .getByLabel("Original request / notes", { exact: true })
    .fill("Disposable survey proof");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../previews/atif-individual-survey.png",
    fullPage: true,
  });
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/project-workflow") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Review Survey Request", exact: true })
    .click();
  expect((await created).ok()).toBe(true);
  await page.reload();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Survey Requests / })
    .click();
  await page
    .getByRole("button", { name: "Create survey request", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Create pre-agreed survey batch",
      exact: true,
    })
    .click();
  for (const [i, key] of [
    "20-20-30:Revised",
    "UBL-BESS-20-40",
    "UBL-BESS-30-60",
  ].entries()) {
    if (i)
      await page.getByRole("button", { name: "Add site", exact: true }).click();
    await page
      .getByLabel(`Site ${i + 1} name`, { exact: true })
      .fill("Browser mixed survey " + i);
    await page
      .getByLabel(`Site ${i + 1} branch code`, { exact: true })
      .fill("BROWSER-SURVEY-MIX-" + i);
  }
  await expect(
    page.getByRole("columnheader", {
      name: "Approved configuration / version",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByLabel("Original request / notes", { exact: true })
    .fill("Mixed survey proof without new quotation");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../previews/atif-mixed-survey.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create survey batch", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Survey requests created", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
