import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
    page.getByRole("heading", { name: "You’re ready to get started." }),
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
  await page.getByRole("button", { name: "Save new BOQ", exact: true }).click();
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

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  const cookieBefore = (await context.cookies()).find(
    (c) => c.name === "pz_session",
  )?.value;
  const control = JSON.parse(
    await readFile(".local/e2e-control.json", "utf8"),
  ) as { pid: number };
  process.kill(control.pid, "SIGUSR2");
  // Give the supervisor time to stop the old process, then wait for readiness.
  await new Promise((resolve) => setTimeout(resolve, 600));
  await expect
    .poll(
      async () => {
        try {
          return (await fetch("http://127.0.0.1:3180/api/health")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 15000 },
    )
    .toBe(200);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome, Abu Bakar Siddique." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "You’re ready to get started." }),
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
    page.getByRole("heading", { name: "You’re ready to get started." }),
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
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
