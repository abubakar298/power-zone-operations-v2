import { test, expect } from "@playwright/test";
import { jsPDF } from "jspdf";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") await dialog.accept();
  });
});

test("setup, invalid login, dashboard, reload, process restart, logout, relogin, mobile", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your workspace starts here." }),
  ).toBeVisible();
  await page.getByLabel("Full name").fill("Abu Bakar Siddique");
  await page.getByLabel("Email address").fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-passphrase-298");
  await page.getByLabel("Confirm password").fill("browser-test-passphrase-298");
  await page
    .getByLabel("Setup key")
    .fill("browser-test-setup-key-isolated-only");
  await page.getByRole("button", { name: "Create administrator" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.getByLabel("Email address").fill("admin@example.test");
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Email or password is incorrect.",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-passphrase-298");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Abu Bakar Siddique." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Management document hub" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Abu Bakar Siddique." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Master data", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Master data", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Customers 286" })).toBeVisible();
  await page.getByLabel("Search customers").fill("Meezan");
  await expect(
    page.getByRole("cell", { name: "MBL", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sites 4" }).click();
  await expect(
    page.getByRole("cell", { name: "0128", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Items & specifications 57" }).click();
  await page.getByLabel("Specification status").selectOption("Need to enter");
  await expect(
    page.getByRole("cell", { name: "Solar PV Modules", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Solar PV Modules", exact: true })
    .click();
  await page
    .getByLabel("Technical specification")
    .fill("Approved browser-test specification");
  await page.getByLabel("Status", { exact: true }).selectOption("Approved");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Solar PV Modules", exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("Specification status").selectOption("Approved");
  await expect(
    page.getByRole("cell", {
      name: "Approved browser-test specification",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "History Solar PV Modules", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Version history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close history" }).click();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Team access", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Email activation pending.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Survey & BOQ", exact: true }).click();
  await page.getByRole("button", { name: "New BOQ", exact: true }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption("3");
  await page.getByLabel("New site name").fill("Browser reference site 05850");
  await page.getByLabel("Location", { exact: true }).fill("Lahore");
  await expect(page.getByLabel("Site code", { exact: true })).toHaveValue(
    "05850",
  );
  await page.getByLabel("Panel quantity", { exact: true }).fill("60");
  await page.getByLabel("Panel wattage (W)", { exact: true }).fill("645");
  await page.getByLabel("6mm² DC cable total (m)", { exact: true }).fill("360");
  await page.getByLabel("2.5mm² earth cable (m)", { exact: true }).fill("20");
  await page.getByLabel("6mm² earth cable (m)", { exact: true }).fill("90");
  await page.getByLabel("10mm² earth cable (m)", { exact: true }).fill("90");
  await page
    .getByLabel("Total battery capacity (kWh)", { exact: true })
    .fill("40");
  await page.getByLabel("Structure", { exact: true }).selectOption("Elevated");
  await page
    .getByLabel("Inverter configuration", { exact: true })
    .selectOption("2×15 kW");
  await page
    .getByLabel("Extra smart meter", { exact: true })
    .selectOption("yes");
  await page
    .getByLabel("Genset synchronisation", { exact: true })
    .selectOption("yes");
  await page
    .getByLabel("Solar Panel brand", { exact: true })
    .selectOption({ label: "Any of the Above" });
  await page
    .getByLabel("Inverter brand", { exact: true })
    .selectOption({ label: "Chint Power" });
  await page
    .getByLabel("Battery & BMS brand", { exact: true })
    .selectOption({ label: "Chint Power" });
  await page
    .getByLabel("Cable brand", { exact: true })
    .selectOption({ label: "Newage Cables" });
  await page
    .getByLabel("Switchgear brand", { exact: true })
    .selectOption({ label: "CHINT" });
  await page
    .getByRole("button", { name: "Save survey draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Survey draft saved");
  await expect(page.getByLabel("Panel quantity", { exact: true })).toHaveValue(
    "60",
  );
  await page.getByRole("button", { name: "Back to BOQs", exact: true }).click();
  await page
    .getByRole("button", { name: /Browser reference site 05850/ })
    .click();
  await expect(page.getByLabel("Panel quantity", { exact: true })).toHaveValue(
    "60",
  );
  // OCR test uses a real image and the bundled worker/runtime/language data.
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 400;
    const x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "black";
    x.font = "48px Arial";
    x.fillText("Panel quantity: 60", 50, 100);
    x.fillText("Panel wattage: 645", 50, 190);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .getByLabel("Upload survey document", { exact: true })
    .setInputFiles({
      name: "survey.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await expect(
    page.getByLabel("Extracted source text", { exact: true }),
  ).toHaveValue(/Panel quantity: 60/, { timeout: 90000 });
  const pdfStream =
    "BT /F1 18 Tf 50 700 Td (Survey PDF reference) Tj 0 -30 Td (Panel quantity: 60) Tj 0 -30 Td (Panel wattage: 645) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${pdfStream.length} >>\nstream\n${pdfStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((x) => String(x).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page
    .getByLabel("Upload survey document", { exact: true })
    .setInputFiles({
      name: "survey.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf),
    });
  await expect(
    page.getByLabel("Extracted source text", { exact: true }),
  ).toHaveValue(/Survey PDF reference/, { timeout: 30000 });
  await page
    .getByRole("button", {
      name: "Apply recognised values for review",
      exact: true,
    })
    .click();
  await page
    .getByLabel(
      "I checked the survey fields against the uploaded source documents.",
    )
    .check();
  await page
    .getByRole("button", { name: "Calculate & review BOQ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Costing preview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("PKR 6,456,786", { exact: true })).toBeVisible();
  const pdfDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download costing PDF", exact: true })
    .click();
  const report = await pdfDownload;
  expect(report.suggestedFilename()).toBe("PREVIEW-05850-costing.pdf");
  const pdfPath = await report.path();
  expect((await readFile(pdfPath!)).subarray(0, 5).toString()).toBe("%PDF-");
  const reportHeadings = await page
    .locator(".boq-costing h3")
    .allTextContents();
  expect(reportHeadings.slice(0, 3)).toEqual([
    "Project Costing Summary",
    "EPC Costing Breakup",
    "Project Costing Detailed Breakup",
  ]);

  await page.screenshot({
    path: "test-results/boq-preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/boq-preview-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await page
    .getByLabel("Review comments")
    .fill("Confirm the survey preparation details.");
  await page
    .getByRole("button", { name: "Request revision", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit requested revision", exact: true })
    .click();
  await page
    .getByLabel("Prepared by", { exact: true })
    .fill("Abu Bakar Reviewed");
  await page
    .getByRole("button", { name: "Calculate & review BOQ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  for (const [label, value] of [
    ["Solar", "20"],
    ["Structure", "20"],
    ["BESS", "15"],
    ["Earthing", "20"],
    ["Balance of systems", "20"],
    ["Other items", "20"],
  ])
    await page
      .getByLabel(`Approval ${label} markup %`, { exact: true })
      .fill(value);
  await page
    .getByRole("button", { name: "Approve & send to Coordinator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "BAFL-05850-001-R0", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("PKR 6,456,786", { exact: true })).toBeVisible();
  const savedPdfDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download costing PDF", exact: true })
    .click();
  const savedReport = await savedPdfDownload;
  expect(savedReport.suggestedFilename()).toBe("BAFL-05850-001-R0-costing.pdf");
  const savedPdfPath = await savedReport.path();
  expect((await readFile(savedPdfPath!)).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  const savedReportHeadings = await page
    .locator(".boq-costing h3")
    .allTextContents();
  expect(savedReportHeadings.slice(0, 3)).toEqual([
    "Project Costing Summary",
    "EPC Costing Breakup",
    "Project Costing Detailed Breakup",
  ]);

  await page
    .getByRole("button", { name: "Create revision draft", exact: true })
    .click();
  await page
    .getByLabel("Revision reason", { exact: true })
    .fill("Updated cable routing");
  await page.getByLabel("6mm² DC cable total (m)", { exact: true }).fill("362");
  await page
    .getByRole("button", { name: "Calculate & review BOQ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByLabel("Approval Solar markup %", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Approval Solar markup %", { exact: true }),
  ).toHaveValue("20");
  await page
    .getByRole("checkbox", { name: /Change quotation settings/ })
    .check();
  await expect(
    page.getByLabel("Approval Solar markup %", { exact: true }),
  ).toBeEnabled();
  for (const [label, value] of [
    ["Solar", "20"],
    ["Structure", "20"],
    ["BESS", "15"],
    ["Earthing", "20"],
    ["Balance of systems", "20"],
    ["Other items", "20"],
  ])
    await page
      .getByLabel(`Approval ${label} markup %`, { exact: true })
      .fill(value);
  await page
    .getByRole("button", {
      name: "Approve & create quotation myself",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Commercial pricing", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Approved BOQ revision")).not.toHaveValue("");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Survey & BOQ", exact: true }).click();
  await page
    .getByRole("button", { name: "BAFL-05850-001-R1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "BAFL-05850-001-R1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "BAFL-05850-001-R0 · Initial BOQ",
      exact: true,
    })
    .click();
  await expect(page.getByText("PKR 6,456,786", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create revision draft", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/boq-review-history.png",
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Create quotation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Calculate selling price", exact: true })
    .click();
  await expect(
    page.getByText("PKR 8,824,826.93", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save pricing version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare quotation", exact: true })
    .click();
  await expect(
    page.locator(".quotation-pdf-pages canvas").first(),
  ).toBeVisible();
  const inlineDiscount = page.getByLabel("Quotation discount (PKR)", {
    exact: true,
  });
  await expect(inlineDiscount).toHaveClass("pdf-inline-discount");
  await inlineDiscount.fill("1000.50");
  await expect(page.locator(".pdf-inline-net")).toHaveText("8,823,826.43");
  await inlineDiscount.fill("");
  await expect(page.locator(".pdf-inline-net")).toHaveText("8,824,826.93");
  const description = page.locator(".quote-description textarea").first();
  const originalDescription = await description.inputValue();
  await description.fill(originalDescription + " - reviewed wording");
  await expect(
    page.locator(".quotation-pdf-pages canvas").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save quotation version", exact: true }),
  ).toBeEnabled();
  await inlineDiscount.fill("1000.50");
  await expect(page.locator(".pdf-inline-net")).toHaveText("8,823,826.43");
  await expect(
    page.getByText("Net Total: PKR 8,823,826.43", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save quotation version", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Confirm quotation totals", exact: true })
    .click();
  await expect(
    page.locator(".quotation-pdf-pages canvas").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save quotation version", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Q-BAFL-05850-001-R0-V1", exact: true }),
  ).toBeVisible();
  const quotationDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download quotation PDF", exact: true })
    .click();
  expect((await quotationDownload).suggestedFilename()).toBe(
    "Q-BAFL-05850-001-R0-V1-quotation.pdf",
  );
  await page
    .getByRole("button", { name: "Create new quotation version", exact: true })
    .click();
  await page
    .getByLabel("Quotation revision reason")
    .fill("Management requested commercial validity change");
  await page.getByLabel("Requires costing change").selectOption("no");
  await page
    .getByRole("button", { name: "Start revision", exact: true })
    .click();
  await expect(
    page.locator(".quote-description textarea").first(),
  ).toHaveAttribute("readonly", "");
  await page.getByLabel("Validity", { exact: true }).fill("14 Days");
  await page
    .getByRole("button", { name: "Preview quotation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save quotation version", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Q-BAFL-05850-001-R0-V2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create new quotation version", exact: true })
    .click();
  await page.getByLabel("Revision source").selectOption("Customer");
  await page
    .getByLabel("Quotation revision reason")
    .fill("Customer requested additional equipment");
  await page.getByLabel("Requires costing change").selectOption("yes");
  await page
    .getByRole("button", { name: "Start revision", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revise survey & BOQ", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Include an additional costing item").check();
  await page
    .getByLabel("Additional item description", { exact: true })
    .fill("Additional equipment");
  await page
    .getByLabel("Additional item unit cost (PKR)", { exact: true })
    .fill("100");
  await page
    .getByRole("button", { name: "Calculate & review BOQ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await expect(
    page.getByLabel("Approval Solar markup %", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Approval Solar markup %", { exact: true }),
  ).toHaveValue("20");
  await page
    .getByRole("checkbox", { name: /Change quotation settings/ })
    .check();
  await expect(
    page.getByLabel("Approval Solar markup %", { exact: true }),
  ).toBeEnabled();
  for (const [label, value] of [
    ["Solar", "20"],
    ["Structure", "20"],
    ["BESS", "15"],
    ["Earthing", "20"],
    ["Balance of systems", "20"],
    ["Other items", "20"],
  ])
    await page
      .getByLabel(`Approval ${label} markup %`, { exact: true })
      .fill(value);
  await page
    .getByRole("button", {
      name: "Approve & create quotation myself",
      exact: true,
    })
    .click();
  await page.getByLabel("Price presentation").selectOption("Full Breakup");
  await page
    .getByRole("button", { name: "Calculate selling price", exact: true })
    .click();
  await page.getByLabel("Additional item markup %", { exact: true }).fill("25");
  await page
    .getByRole("button", { name: "Calculate selling price", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save pricing version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare quotation", exact: true })
    .click();
  await expect(page.locator(".quote-description")).toHaveCount(17);
  await expect(
    page.locator(".quotation-pdf-pages canvas").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save quotation version", exact: true })
    .click();
  await expect(page.getByText(/^Customer revision ·/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Quotations", exact: true }).click();
  await page.getByRole("button", { name: /Q-BAFL-05850-001-R2-V1/ }).click();
  await page
    .getByRole("button", { name: "Create new quotation version", exact: true })
    .click();
  await page
    .getByLabel("Quotation revision reason")
    .fill("Internal validity change after refresh");
  await page.getByLabel("Requires costing change").selectOption("no");
  await page
    .getByRole("button", { name: "Start revision", exact: true })
    .click();
  await expect(page.locator(".quote-description")).toHaveCount(17);
  await expect(
    page.locator(".quote-description textarea").last(),
  ).toHaveAttribute("readonly", "");
  await page
    .getByRole("button", { name: "Preview quotation", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/quotation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Toggle navigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Quotations", exact: true }).click();
  await page.getByRole("button", { name: /Q-BAFL-05850-001-R0-V1/ }).click();
  await expect(page.locator(".quote-metadata")).toContainText("7 Days");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Customer PO & IPO", exact: true })
    .click();
  const acceptedQuote = page.getByLabel("Accepted quotation");
  await expect(
    acceptedQuote
      .locator("option")
      .filter({ hasText: "Q-BAFL-05850-001-R0-V1" }),
  ).toHaveCount(1);
  await acceptedQuote.selectOption(
    (await acceptedQuote
      .locator("option")
      .filter({ hasText: "Q-BAFL-05850-001-R0-V1" })
      .getAttribute("value"))!,
  );
  await expect(page.getByLabel("Sale confirmation type")).toHaveValue("");
  await expect(
    page.getByLabel("Sales person", { exact: true }),
  ).not.toHaveValue("");
  await expect(
    page.getByLabel("Delivery address", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Customer NTN", { exact: true })).toHaveCount(0);
  await page.getByLabel("Sale confirmation type").selectOption("Customer PO");
  const poFile = new jsPDF();
  poFile.text(
    [
      "PO Number: BROWSER-PO-001",
      "PO Date: 2026-10-06",
      "NTN: 1234567-8",
      "STRN: 00123456",
      "Billing address: 4 Test Billing Road",
    ],
    14,
    20,
  );
  await page
    .getByLabel("Customer PO document", { exact: false })
    .setInputFiles({
      name: "test-po.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(poFile.output("arraybuffer")),
    });
  await expect(
    page.getByText("PO suggestions filled.", { exact: false }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("Order date", { exact: true })).toHaveValue(
    "2026-10-06",
  );
  await expect(page.getByLabel("Customer NTN", { exact: true })).toHaveValue(
    "1234567-8",
  );
  await page
    .getByText("Edit customer & billing details", { exact: true })
    .click();
  await expect(page.getByLabel("Billing address", { exact: true })).toHaveValue(
    "4 Test Billing Road",
  );
  await page
    .getByLabel("Customer PO reference", { exact: true })
    .fill("BROWSER-PO-001");
  await page.getByLabel("Company to invoice").fill("PZES (Pvt) Ltd.");
  await page
    .getByLabel("Approval evidence / verbal confirmation details")
    .fill("Customer PO received against this exact quotation.");
  await page.getByLabel(/Sale has been confirmed against/).check();
  await page.getByRole("button", { name: "Review IPO", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "IPO preview · Not saved" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Submit evidence for IPO approval" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "IPO submission · Awaiting evidence approval",
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Customer PO & IPO", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Q-BAFL-05850-001-R0-V1 · Customer PO ·/ })
    .click();
  await page
    .getByRole("button", { name: "Approve evidence & save IPO" })
    .click();
  await expect(
    page.getByRole("heading", { name: "IPO-000001 · Saved IPO" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send IPO to Accounts", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sent to Accounts by" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send IPO to Accounts", exact: true }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download IPO & Peachtree PDF" })
    .click();
  const ipoDownload = await downloadPromise;
  expect(ipoDownload.suggestedFilename()).toBe(
    "IPO-000001-IPO-and-Peachtree.pdf",
  );
  const ipoFile = await ipoDownload.path();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const packDocument = await getDocument({
    data: new Uint8Array(await readFile(ipoFile!)),
    useSystemFonts: true,
  }).promise;
  expect(packDocument.numPages).toBeGreaterThanOrEqual(2);
  const lastPage = await packDocument.getPage(packDocument.numPages);
  const packText = (await lastPage.getTextContent()).items
    .map((i: any) => i.str ?? "")
    .join(" ");
  expect(packText).toContain("PEACHTREE DIVISION");
  expect(packText).toContain("IPO-000001");
  await packDocument.destroy();
  await ipoDownload.saveAs("test-results/ipo-browser.pdf");
  await page
    .getByRole("button", { name: "Send BOQ to Operations", exact: true })
    .click();
  await page
    .getByLabel("Instructions to Operations")
    .fill("Browser-test handoff: prepare the approved requirements.");
  await expect(
    page.getByRole("heading", { name: "Requirements to send" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Send BOQ to Operations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "OPS-BOQ-000001", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "BOQ to Operations", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: /^OPS-BOQ-000001/ }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Operations · Received BOQs", exact: true })
    .click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await page
    .getByLabel("Delivery address", { exact: true })
    .fill("4 Operations Delivery Road");
  await page
    .getByLabel("Contact person on site", { exact: true })
    .fill("Test site supervisor");
  await page
    .getByLabel("Site contact number", { exact: true })
    .fill("03001234567");
  await page.getByLabel("Delivery date", { exact: true }).fill("2026-10-08");
  await page.getByLabel("Delivery time", { exact: true }).fill("10:30");
  await page
    .getByRole("button", { name: "Save delivery details", exact: true })
    .click();
  await expect(
    page.getByText("Delivery details saved by Operations.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "BOQ to Operations", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Operations · Received BOQs", exact: true })
    .click();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(
    page.getByLabel("Delivery address", { exact: true }),
  ).toHaveValue("4 Operations Delivery Road");
  await expect(page.getByLabel("Delivery time", { exact: true })).toHaveValue(
    "10:30",
  );
  await page
    .getByRole("button", { name: "Issue BOQ to Store", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download Store BOQ", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save delivery details", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Stock demand/ }).click();
  await expect(
    page.getByRole("columnheader", { name: "Sent to Store", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/operations-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/ipo-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pending tasks" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Management document hub" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/coordinator-desktop.png",
    fullPage: true,
  });
  const cookieBefore = (await context.cookies()).find(
    (c) => c.name === "pz_session",
  )?.value;
  const control = JSON.parse(
    await readFile(".local/e2e-control.json", "utf8"),
  ) as { pid: number; generation: number };
  process.kill(control.pid, "SIGUSR2");
  // Wait for supervisor confirmation of a healthy replacement process.
  await expect
    .poll(
      async () => {
        try {
          const restarted = JSON.parse(
            await readFile(".local/e2e-control.json", "utf8"),
          );
          if (restarted.generation <= control.generation) return 0;
          return (
            await fetch(
              `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}/api/health`,
            )
          ).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Abu Bakar Siddique." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Management document hub" }),
  ).toBeVisible();
  expect(
    (await context.cookies()).find((c) => c.name === "pz_session")?.value,
  ).toBe(cookieBefore);
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  const replay = await context.request.get("/api/dashboard", {
    headers: { Cookie: `pz_session=${cookieBefore}` },
  });
  expect(replay.status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Email address").fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-passphrase-298");
  await page.screenshot({
    path: "test-results/login-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Abu Bakar Siddique." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Management document hub" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Abu Bakar Siddique Admin" }).click();
  await expect(page.locator("#account-menu")).toBeVisible();
  await page.getByRole("button", { name: "Abu Bakar Siddique Admin" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Team access", exact: true }).click();
  await page
    .getByRole("button", { name: "Create account with password", exact: true })
    .click();
  await page.getByLabel("New account name").fill("Atif Hameed");
  await page
    .getByLabel("New account password", { exact: true })
    .fill("browser-coordinator-only-298");
  await page
    .getByLabel("Confirm new account password")
    .fill("browser-coordinator-only-298");
  await page.getByLabel("Employee email").fill("atif-browser@example.test");
  await page.getByLabel("Employee role").selectOption("Coordinator");
  await page
    .getByLabel("Your current password")
    .fill("browser-test-passphrase-298");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Account created");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email address").fill("atif-browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-coordinator-only-298");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Atif Hameed." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Operations Coordination" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Team access", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Work stages" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Survey & BOQ", exact: true }).click();
  await page.getByRole("button", { name: "New BOQ", exact: true }).click();
  await page
    .getByLabel("New site name", { exact: true })
    .fill("SAMPLE bucket training");
  await page
    .getByRole("button", { name: "Save survey draft", exact: true })
    .click();
  await expect(
    page.getByText("Survey draft saved", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /Survey preparation/ }).click();
  await expect(
    page.getByRole("row", { name: /SAMPLE bucket training/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open workflow", exact: true })
    .click();
  await expect(page.getByLabel("New site name", { exact: true })).toHaveValue(
    "SAMPLE bucket training",
  );
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.screenshot({
    path: "test-results/atif-dashboard-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("management bucket opens a coordinator costing review and isolates approval work", async ({
  page,
}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "atif-browser@example.test",
      password: "browser-coordinator-only-298",
    },
  });
  expect(login.ok()).toBe(true);
  const session = await login.json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Master data", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add customer", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  for (const name of ["Sites", "Rates", "Items & specifications"]) {
    await page.getByRole("tab", { name: new RegExp(`^${name} `) }).click();
    await expect(
      page.getByRole("button", { name: /^Edit / }).first(),
    ).toBeVisible();
  }
  await page.getByRole("tab", { name: /^Engineering rules / }).click();
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await page.getByRole("button", { name: "Survey & BOQ", exact: true }).click();
  await page
    .getByRole("button", { name: "Quick BOQ · no survey", exact: true })
    .click();
  await page
    .getByLabel("New site name", { exact: true })
    .fill("Preserve unsaved site");
  await page.getByRole("button", { name: "Add customer", exact: true }).click();
  const customerDialog = page.getByRole("dialog", {
    name: "Add customer",
    exact: true,
  });
  await customerDialog
    .getByLabel("Customer name", { exact: true })
    .fill("SAMPLE Quick quote customer");
  await customerDialog
    .getByLabel("Short code", { exact: true })
    .fill("BROWSER-QUICK-CUSTOMER");
  await customerDialog
    .getByRole("button", { name: "Add customer & continue", exact: true })
    .click();
  await expect(customerDialog).not.toBeVisible();
  await expect(
    page.getByLabel("Customer", { exact: true }).locator("option:checked"),
  ).toContainText("SAMPLE Quick quote customer");
  await expect(page.getByLabel("New site name", { exact: true })).toHaveValue(
    "Preserve unsaved site",
  );
  await page.screenshot({
    path: "test-results/coordinator-master-access.png",
    fullPage: true,
  });
  const masters = await (await page.request.get("/api/masters")).json();
  const brand = (category: string) =>
    masters.brands.find(
      (b: any) => b.category === category && b.status === "Active",
    ).id;
  const inputs = {
    customerId: 0,
    siteName: "SAMPLE Management bucket review",
    siteCode: "MGRBUCKET",
    location: "Lahore",
    panelQty: 30,
    panelWattage: "645",
    structure: "L2",
    dcMetres: "120",
    earth25: "20",
    earth6: "40",
    earth10: "40",
    inverter: "20 kW",
    batteryKwh: 15,
    smartMeter: false,
    genset: false,
    preparedBy: "Atif Hameed",
    brands: {
      solar: brand("Solar Panel"),
      inverter: brand("Inverter"),
      battery: brand("Battery & BMS"),
      cable: brand("Cable"),
      switchgear: brand("Switchgear"),
    },
  };
  const saved = await page.request.post("/api/boqs/drafts", {
    headers,
    data: { version: 0, inputs },
  });
  expect(saved.ok()).toBe(true);
  const draft = await saved.json();
  const preview = await (
    await page.request.post("/api/boqs/preview", { headers, data: inputs })
  ).json();
  const submitted = await page.request.post("/api/boqs/reviews", {
    headers,
    data: {
      draftId: draft.id,
      version: draft.version,
      fingerprint: preview.fingerprint,
    },
  });
  expect(submitted.ok()).toBe(true);
  await page.request.post("/api/auth/logout", { headers });
  const admin = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "admin@example.test",
      password: "browser-test-passphrase-298",
    },
  });
  expect(admin.ok()).toBe(true);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Management document hub" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Customer & site budgets", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Customer & site portfolio" }),
  ).toBeVisible();
  await page.getByLabel("Reporting customer").selectOption("3");
  await expect(
    page.getByRole("button", { name: "View site budget" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "View site budget" }).first().click();
  await expect(
    page.getByRole("heading", { name: /Peachtree phase comparison/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Not entered", exact: true }),
  ).toHaveCount(6);
  await page.screenshot({
    path: "test-results/director-portfolio.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  await expect(page.getByLabel("Work scope")).toHaveValue("team");
  await page
    .getByLabel("Show documents awaiting management action only")
    .check();
  await expect(
    page.getByRole("row", { name: /SAMPLE bucket training/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Costing review/ }).click();
  const row = page.getByRole("row", {
    name: /SAMPLE Management bucket review/,
  });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open workflow" }).click();
  await expect(
    page.getByRole("heading", { name: /Costing review · Draft version/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Demo Sites · SAMPLE Management bucket review · Site code MGRBUCKET/,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/management-bucket-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to BOQs", exact: true }).click();
  await page.getByRole("button", { name: "Quick BOQ · no survey" }).click();
  await page.getByLabel("Customer", { exact: true }).selectOption("3");
  await page.getByLabel("New site name").fill("Quick proposal 67890");
  await page.getByLabel("Panel quantity", { exact: true }).fill("60");
  await page.getByLabel("Panel wattage (W)", { exact: true }).fill("645");
  await page
    .getByLabel("Inverter configuration", { exact: true })
    .selectOption("2×15 kW");
  await page
    .getByLabel("Total battery capacity (kWh)", { exact: true })
    .fill("40");
  for (const [field, label] of [
    ["Solar Panel brand", "Any of the Above"],
    ["Inverter brand", "Chint Power"],
    ["Battery & BMS brand", "Chint Power"],
    ["Cable brand", "Newage Cables"],
    ["Switchgear brand", "CHINT"],
  ])
    await page.getByLabel(field, { exact: true }).selectOption({ label });
  await expect(
    page.getByRole("heading", { name: "Automatic cable allowances" }),
  ).toBeVisible();
  await expect(page.getByText("174.15 m", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("Upload survey document")).toHaveCount(0);
  await expect(page.getByLabel("6mm² DC cable total (m)")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Calculate & review BOQ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Costing preview", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/quick-boq-desktop.png",
    fullPage: true,
  });
});

test("Coordinator records external approval with screenshots and receives its quotation settings", async ({
  page,
}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "atif-browser@example.test",
      password: "browser-coordinator-only-298",
    },
  });
  expect(login.ok()).toBe(true);
  const session = await login.json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
  const masters = await (await page.request.get("/api/masters")).json();
  const brand = (category: string) =>
    masters.brands.find(
      (b: any) => b.category === category && b.status === "Active",
    ).id;
  const inputs = {
    sourceMode: "General quotation",
    customerId: 0,
    siteName: "SAMPLE External chat approval",
    siteCode: "CHATBROWSER",
    location: "Lahore",
    panelQty: 30,
    panelWattage: "645",
    structure: "L2",
    dcMetres: "0",
    earth25: "0",
    earth6: "0",
    earth10: "0",
    inverter: "20 kW",
    batteryKwh: 15,
    smartMeter: false,
    genset: false,
    preparedBy: "Atif",
    brands: {
      solar: brand("Solar Panel"),
      inverter: brand("Inverter"),
      battery: brand("Battery & BMS"),
      cable: brand("Cable"),
      switchgear: brand("Switchgear"),
    },
  };
  const d = await (
    await page.request.post("/api/boqs/drafts", {
      headers,
      data: { version: 0, inputs },
    })
  ).json();
  const p = await (
    await page.request.post("/api/boqs/preview", { headers, data: inputs })
  ).json();
  const s = await page.request.post("/api/boqs/reviews", {
    headers,
    data: { draftId: d.id, version: d.version, fingerprint: p.fingerprint },
  });
  expect(s.ok()).toBe(true);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Costing review/ }).click();
  await page
    .getByRole("row", { name: /SAMPLE External chat approval/ })
    .getByRole("button", { name: "Open workflow" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Record approval received outside the app",
    }),
  ).toBeVisible();
  await page.getByLabel("External approver name").fill("Director Operations");
  await page
    .getByLabel("Approval quotation format")
    .selectOption("Full Breakup");
  await page.getByLabel("Approval tax display").selectOption("Tax Included");
  await page.getByLabel("Approval BESS markup %").fill("33");
  await page
    .getByLabel("Instructions for quotation")
    .fill("Approved costing and these quotation settings.");
  const screenshot = await page.screenshot();
  await page.getByLabel("Approval screenshots").setInputFiles({
    name: "sample-approval.png",
    mimeType: "image/png",
    buffer: screenshot,
  });
  await expect(
    page.getByText("sample-approval.png", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(
      "I confirm these screenshots approve this exact costing and the quotation instructions entered above.",
    )
    .check();
  await page
    .getByRole("button", { name: "Record external approval & save BOQ" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "External costing approval recorded",
  );
  await page
    .getByRole("button", { name: "Create revision draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revise general BOQ", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("87.075 m", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("6mm² DC cable total (m)")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to BOQs", exact: true }).click();
  await page
    .getByRole("button", { name: "DEMO-CHATBROWSER-001-R0", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create quotation", exact: true })
    .click();
  await expect(page.getByLabel("Price presentation")).toHaveValue(
    "Full Breakup",
  );
  await expect(
    page.getByLabel("Tax presentation", { exact: true }),
  ).toHaveValue("Tax Included");
  await expect(page.getByLabel("BESS Markup %", { exact: true })).toHaveValue(
    "33",
  );
  await page.screenshot({
    path: "test-results/external-approval-pricing.png",
    fullPage: true,
  });
});

test("Inventory and Accounts roles have dedicated queues, original PDFs and isolated progress actions", async ({
  page,
}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "admin@example.test",
      password: "browser-test-passphrase-298",
    },
  });
  expect(login.ok()).toBe(true);
  const session = await login.json(),
    headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
  for (const role of ["Inventory", "Accounts"]) {
    const created = await page.request.post("/api/accounts/create", {
      headers,
      data: {
        email: `${role.toLowerCase()}@example.test`,
        displayName: `Test ${role}`,
        role,
        password: "browser-test-passphrase-298",
        newPassword: "department-browser-only-298",
        confirmPassword: "department-browser-only-298",
      },
    });
    expect(created.status()).toBe(201);
  }
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Inventory workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inventory workspace", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Open document", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "Download issued BOQ" }),
  ).toBeVisible();
  await page
    .getByLabel("Progress note / missing documents")
    .fill("SAMPLE: stock preparation started");
  await page
    .getByRole("button", { name: "Record progress", exact: true })
    .click();
  await page.getByRole("button", { name: /Preparing stock/ }).click();
  await page
    .getByRole("button", { name: "Open document", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("SAMPLE: stock preparation started"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/inventory-dashboard.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Accounts workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open document", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "Download IPO & Peachtree PDF" }),
  ).toBeVisible();
  await page.getByLabel("Next stage").selectOption("Awaiting documents");
  await page
    .getByLabel("Progress note / missing documents")
    .fill("SAMPLE: signed delivery order pending");
  await page
    .getByRole("button", { name: "Record progress", exact: true })
    .click();
  await page.getByRole("button", { name: /Awaiting documents/ }).click();
  await page
    .getByRole("button", { name: "Open document", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("SAMPLE: signed delivery order pending"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/accounts-dashboard.png",
    fullPage: true,
  });
  for (const role of ["Inventory", "Accounts"]) {
    const login = await page.request.post("/api/auth/login", {
      headers: { Origin: origin },
      data: {
        email: `${role.toLowerCase()}@example.test`,
        password: "department-browser-only-298",
      },
    });
    expect(login.ok()).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: `${role} workspace`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Commercial pricing", exact: true }),
    ).toHaveCount(0);
    const denied = await page.request.get(
      `/api/departments/${role === "Inventory" ? "Accounts" : "Inventory"}`,
    );
    expect(denied.status()).toBe(403);
  }
  expect(errors).toEqual([]);
});

test("Atif completes an approved sample through quotation, IPO and Operations with safe cancellation", async ({
  page,
  browser,
}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "atif-browser@example.test",
      password: "browser-coordinator-only-298",
    },
  });
  expect(login.ok()).toBe(true);
  const session = await login.json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Quotation preparation/ }).click();
  await page
    .getByRole("row", { name: /SAMPLE External chat approval/ })
    .getByRole("button", { name: "Open workflow" })
    .click();
  await page
    .getByRole("button", { name: "Calculate selling price", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save pricing version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare quotation", exact: true })
    .click();
  await expect(
    page.locator(".quotation-pdf-pages canvas").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save quotation version", exact: true })
    .click();
  const quoteHeading = page.getByRole("heading", {
    name: /^Q-DEMO-CHATBROWSER/,
  });
  await expect(quoteHeading).toBeVisible();
  const number = await quoteHeading.innerText();
  const quotes = await (
    await page.request.get("/api/commercial/quotations")
  ).json();
  const quote = quotes.quotations.find((q: any) => q.number === number);
  expect(quote).toBeTruthy();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page
    .getByRole("button", { name: /Ready for quotation approval/ })
    .click();
  const row = page.getByRole("row", { name: new RegExp(number) });
  await expect(
    row.getByRole("button", { name: "Send for approval" }),
  ).toBeVisible();
  page.removeAllListeners("dialog");
  page.once("dialog", async (d) => {
    expect(d.message()).toContain("Send quotation for approval");
    await d.dismiss();
  });
  await row.getByRole("button", { name: "Send for approval" }).click();
  await expect(
    row.getByRole("button", { name: "Send for approval" }),
  ).toBeVisible();
  const unchanged = await (await page.request.get("/api/coordinator")).json();
  expect(unchanged.tasks.find((t: any) => t.id === quote.id).stage).toBe(
    "Ready for quotation approval",
  );
  page.on("dialog", async (d) => {
    if (d.type() === "confirm") await d.accept();
    else if (d.type() === "prompt")
      await d.accept("SAMPLE PO received for final workflow check");
  });
  await row.getByRole("button", { name: "Send for approval" }).click();
  await expect(row).toHaveCount(0);
  const denied = await page.request.post("/api/coordinator/events", {
    headers,
    data: { quotationId: quote.id, kind: "Approved" },
  });
  expect(denied.status()).toBe(403);
  const manager = await browser.newContext();
  try {
    const ml = await manager.request.post(`${origin}/api/auth/login`, {
      headers: { Origin: origin },
      data: {
        email: "admin@example.test",
        password: "browser-test-passphrase-298",
      },
    });
    expect(ml.ok()).toBe(true);
    const mh = { Origin: origin, "X-CSRF-Token": (await ml.json()).csrfToken };
    expect(
      (
        await manager.request.post(`${origin}/api/coordinator/events`, {
          headers: mh,
          data: { quotationId: quote.id, kind: "Approved" },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: /Customer confirmation/ }).click();
    await page
      .getByRole("row", { name: new RegExp(number) })
      .getByRole("button", { name: "Record PO / approval received" })
      .click();
    await page.getByRole("button", { name: /IPO preparation/ }).click();
    await page
      .getByRole("row", { name: new RegExp(number) })
      .getByRole("button", { name: "Open workflow" })
      .click();
    await expect(page.getByLabel("Accepted quotation")).toHaveValue(quote.id);
    await page
      .getByLabel("Sale confirmation type")
      .selectOption("Verbal sale confirmation");
    await page
      .getByLabel("Company to invoice")
      .fill("SAMPLE Power Zone workflow test");
    await page
      .getByLabel("Approval evidence / verbal confirmation details")
      .fill(
        "SAMPLE ONLY: confirmed exact sample quotation for isolated workflow testing.",
      );
    await page.getByLabel(/Sale has been confirmed against/).check();
    await page.getByRole("button", { name: "Review IPO", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Approve evidence & save IPO" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Submit evidence for IPO approval" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "IPO submission · Awaiting evidence approval",
      }),
    ).toBeVisible();
    const submissions = await (
      await manager.request.get(`${origin}/api/orders/submissions`)
    ).json();
    const submission = submissions.submissions.find(
      (s: any) =>
        s.quotation_id === quote.id || s.input?.quotationId === quote.id,
    );
    expect(submission).toBeTruthy();
    const approved = await manager.request.post(
      `${origin}/api/orders/submissions/${submission.id}/approve`,
      { headers: mh, data: { requestKey: crypto.randomUUID() } },
    );
    expect(approved.ok()).toBe(true);
    const ipo = await approved.json();
    await page.reload();
    await page.getByRole("button", { name: /Operations handoff/ }).click();
    await page
      .getByRole("row", { name: new RegExp(ipo.number) })
      .getByRole("button", { name: "Open workflow" })
      .click();
    await page
      .getByLabel("Instructions to Operations")
      .fill("SAMPLE ONLY: approved requirements for workflow verification.");
    await page
      .getByRole("button", { name: "Send BOQ to Operations", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /^OPS-BOQ-/ }),
    ).toBeVisible();
    const pack = await page.request.get(`/api/orders/${ipo.id}/ipo.pdf`);
    expect(pack.ok()).toBe(true);
    expect((await pack.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.screenshot({
      path: "test-results/atif-final-workflow-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/atif-final-workflow-mobile.png",
      fullPage: true,
    });
    // Another tab changes account; logout must invalidate that current session safely.
    const changed = await page.request.post("/api/auth/login", {
      headers: { Origin: origin },
      data: {
        email: "admin@example.test",
        password: "browser-test-passphrase-298",
      },
    });
    expect(changed.ok()).toBe(true);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
  } finally {
    await manager.close();
  }
});

test("quotation page saves and submits, management previews discount and requests revision in place", async ({
  page,
}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? 3180}`;
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "admin@example.test",
      password: "browser-test-passphrase-298",
    },
  });
  expect(login.ok()).toBe(true);
  const session = await login.json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrfToken };
  const pricingList = await (
    await page.request.get("/api/commercial/pricing")
  ).json();
  const source = await (
    await page.request.get(
      `/api/commercial/pricing/${pricingList.pricing[0].id}`,
    )
  ).json();
  async function newPricing() {
    const quotes = await (
      await page.request.get("/api/commercial/quotations")
    ).json();
    const latest = quotes.quotations.find(
      (q: any) => q.boq_revision_id === source.boq_revision_id,
    );
    let revisionRequestId;
    if (latest) {
      const revision = await page.request.post(
        "/api/commercial/revision-requests",
        {
          headers,
          data: {
            sourceQuotationId: latest.id,
            origin: "Internal management",
            costingChange: false,
            reason: "Browser quotation review regression",
            requestedBy: "Browser manager",
            requestKey: crypto.randomUUID(),
          },
        },
      );
      expect(revision.ok()).toBe(true);
      revisionRequestId = (await revision.json()).id;
    }
    const input = { ...source.snapshot.input, revisionRequestId };
    const pv = await page.request.post("/api/commercial/pricing/preview", {
      headers,
      data: input,
    });
    expect(pv.ok()).toBe(true);
    const saved = await page.request.post("/api/commercial/pricing", {
      headers,
      data: {
        ...input,
        fingerprint: (await pv.json()).fingerprint,
        requestKey: crypto.randomUUID(),
      },
    });
    expect(saved.ok()).toBe(true);
    return saved.json();
  }
  const price = await newPricing();
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Commercial pricing", exact: true })
    .click();
  await page.getByRole("button", { name: new RegExp(price.number) }).click();
  await page
    .getByRole("button", { name: "Prepare quotation", exact: true })
    .click();
  await expect(
    page.locator(".quotation-pdf-pages canvas").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and send for approval", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quotation workflow · Submitted" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Document workflow history", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Quotation under review" }),
  ).toContainText("Awaiting quotation approval");
  const link = page.getByRole("link", {
    name: "Download quotation PDF",
    exact: true,
  });
  const href = (await link.getAttribute("href"))!;
  const id = href.split("/").at(-2)!;
  const saved = await (
    await page.request.get(`/api/commercial/quotations/${id}`)
  ).json();
  const discount = page.getByLabel("Quotation discount (PKR)", { exact: true });
  await expect(discount).toBeVisible();
  const initial = Number(saved.snapshot.input.discount ?? 0);
  const originalNet = Number(saved.snapshot.footer.at(-1).amount);
  await discount.fill(String(initial + 1000));
  await expect(page.locator(".pdf-inline-net")).toHaveText(
    (originalNet - 1000).toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );
  await expect(
    page.getByRole("row", { name: /Profit % on cost/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve quotation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Request revision");
  await discount.fill("");
  await expect(page.locator(".pdf-inline-net")).toHaveText(
    (originalNet + initial).toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );
  await page
    .getByLabel("Review comments", { exact: true })
    .fill("Please apply the reviewed discount instruction.");
  await page
    .getByRole("button", { name: "Request revision", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm revision request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Quotation workflow · Changes requested",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Latest quotation feedback")).toContainText(
    "Please apply the reviewed discount instruction.",
  );
  expect(
    (await (await page.request.get(`/api/commercial/quotations/${id}`)).json())
      .snapshot,
  ).toEqual(saved.snapshot);
  // Dashboard feedback uses an application form and supports cancellation.
  const next = await newPricing();
  const qi = {
    pricingId: next.id,
    revisionRequestId: next.snapshot.input.revisionRequestId,
    quotedDate: "2026-10-07",
    validity: "7 Days",
    proposedBy: "Browser review test",
    discount: "0",
  };
  const qp = await (
    await page.request.post("/api/commercial/quotations/preview", {
      headers,
      data: qi,
    })
  ).json();
  const q = await (
    await page.request.post("/api/commercial/quotations", {
      headers,
      data: {
        ...qi,
        fingerprint: qp.fingerprint,
        requestKey: crypto.randomUUID(),
      },
    })
  ).json();
  expect(
    (
      await page.request.post("/api/coordinator/events", {
        headers,
        data: { quotationId: q.id, kind: "Submitted" },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: /Quotation approval/ }).click();
  const row = page.getByRole("row", { name: new RegExp(q.number) });
  await row
    .getByRole("button", { name: "Request revision", exact: true })
    .click();
  await page
    .getByLabel("Revision feedback", { exact: true })
    .fill("Revise the quotation wording.");
  await page
    .getByRole("button", { name: "Cancel revision request", exact: true })
    .click();
  expect(
    (
      await (
        await page.request.get(`/api/commercial/quotations/${q.id}`)
      ).json()
    ).workflow_status,
  ).toBe("Submitted");
  await row
    .getByRole("button", { name: "Request revision", exact: true })
    .click();
  await page
    .getByLabel("Revision feedback", { exact: true })
    .fill("Revise the quotation wording.");
  await page
    .getByRole("button", { name: "Confirm revision request", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    (
      await (
        await page.request.get(`/api/commercial/quotations/${q.id}`)
      ).json()
    ).workflow_status,
  ).toBe("Changes requested");
  const approvalPrice = await newPricing();
  const approvalInput = {
    ...qi,
    pricingId: approvalPrice.id,
    revisionRequestId: approvalPrice.snapshot.input.revisionRequestId,
  };
  const ap = await (
    await page.request.post("/api/commercial/quotations/preview", {
      headers,
      data: approvalInput,
    })
  ).json();
  const aq = await (
    await page.request.post("/api/commercial/quotations", {
      headers,
      data: {
        ...approvalInput,
        fingerprint: ap.fingerprint,
        requestKey: crypto.randomUUID(),
      },
    })
  ).json();
  expect(
    (
      await page.request.post("/api/coordinator/events", {
        headers,
        data: { quotationId: aq.id, kind: "Submitted" },
      })
    ).ok(),
  ).toBe(true);
  await page.getByRole("button", { name: "Quotations", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(aq.number) }).click();
  await expect(
    page.getByRole("button", { name: "Approve quotation", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Review comments", { exact: true })
    .fill("Approved after reviewing the saved quotation.");
  await page
    .getByRole("button", { name: "Approve quotation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quotation workflow · Approved" }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(`/api/commercial/quotations/${aq.id}`)
      ).json()
    ).workflow_status,
  ).toBe("Approved");
});
