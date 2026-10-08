import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
const adminPassword = "browser-test-passphrase-298";
const employeePassword = "isolated-coordinator-journey-298";
async function login(page: Page, email: string, password = employeePassword) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
for (const quick of [false, true]) {
  test(`Coordinator ${quick ? "Quick BOQ with existing site" : "survey"} through management, quotation, IPO and both handoffs`, async ({
    page,
    browser,
  }) => {
    const suffix = quick ? "quick" : "survey";
    const adminContext = await browser.newContext({ baseURL: origin });
    const managerContext = await browser.newContext({ baseURL: origin });
    const outsiderContext = await browser.newContext({ baseURL: origin });
    const admin = await adminContext.newPage(),
      manager = await managerContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const p of [page, manager])
      p.on("dialog", async (d) => {
        if (d.type() === "confirm") await d.accept();
      });
    try {
      if (
        (await (await admin.request.get("/api/auth/status")).json())
          .setupRequired
      ) {
        expect(
          (
            await admin.request.post("/api/auth/setup", {
              headers: { Origin: origin },
              data: {
                email: "admin@example.test",
                displayName: "Abu Bakar Siddique",
                password: adminPassword,
                setupToken: "browser-test-setup-key-isolated-only",
              },
            })
          ).status(),
        ).toBe(201);
      }
      const al = await admin.request.post("/api/auth/login", {
        headers: { Origin: origin },
        data: { email: "admin@example.test", password: adminPassword },
      });
      expect(al.ok()).toBe(true);
      const ah = {
        Origin: origin,
        "X-CSRF-Token": (await al.json()).csrfToken,
      };
      for (const [name, role] of [
        ["Atif", "Coordinator"],
        ["Director", "Management"],
        ["Other", "Coordinator"],
      ]) {
        expect(
          (
            await admin.request.post("/api/accounts/create", {
              headers: ah,
              data: {
                email: `${name.toLowerCase()}-${suffix}@example.test`,
                displayName: `${name} ${suffix}`,
                role,
                password: adminPassword,
                newPassword: employeePassword,
                confirmPassword: employeePassword,
              },
            })
          ).status(),
        ).toBe(201);
      }
      await login(page, `atif-${suffix}@example.test`);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: `Welcome, Atif ${suffix}.` }),
      ).toBeVisible();
      for (const path of [
        "/api/director/portfolio",
        "/api/accounts",
        "/api/backups",
        "/api/departments/Accounts",
        "/api/departments/Inventory",
      ])
        expect((await page.request.get(path)).status(), path).toBe(403);
      await button(page, "Survey & BOQ").click();
      await button(page, quick ? "Quick BOQ · no survey" : "New BOQ").click();
      await page.getByLabel("Find BOQ customer").fill("Alfalah");
      await page.getByLabel("Customer", { exact: true }).selectOption("3");
      // Filtering must retain the selected identity, rather than silently picking another customer.
      await page
        .getByLabel("Find BOQ customer")
        .fill("no matching other customer");
      await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
        "3",
      );
      await page.getByLabel("Find BOQ customer").fill("");
      if (quick) {
        await page.getByLabel("Find BOQ site").fill("Skardu");
        await expect(
          page.getByLabel("Existing site").locator("option"),
        ).toHaveCount(2);
        await page.getByLabel("Existing site").selectOption("2");
        await expect(
          page.getByLabel("New site name", { exact: true }),
        ).toHaveValue("Skardu -2520");
        await expect(page.getByLabel("Site code", { exact: true })).toHaveValue(
          "2520",
        );
      } else {
        // Customer switching clears a site belonging to the previous customer.
        await page.getByLabel("Existing site").selectOption("2");
        await page.getByLabel("Customer", { exact: true }).selectOption("2");
        await expect(page.getByLabel("Site code", { exact: true })).toHaveValue(
          "",
        );
        await page.getByLabel("Customer", { exact: true }).selectOption("3");
        await page
          .getByLabel("New site name", { exact: true })
          .fill("Coordinator validation 90901");
        await page.getByLabel("Location", { exact: true }).fill("Lahore");
      }
      await page.getByLabel("Panel quantity", { exact: true }).fill("60");
      await page.getByLabel("Panel wattage (W)", { exact: true }).fill("645");
      expect(await page.getByLabel("Panel wattage (W)", { exact: true }).evaluate(input => {
        const next = input.closest("label")?.nextElementSibling;
        return next?.querySelector('select[name="bessId"]') !== null;
      })).toBe(true);
      for (let capacity = 5; capacity <= 60; capacity += 5) {
        await page.getByLabel("BESS configuration", { exact: true }).selectOption(`6-${capacity}`);
        await expect(page.locator('input[name="inverter"]')).toHaveValue("6 kW SP");
        await expect(page.locator('input[name="batteryKwh"]')).toHaveValue(String(capacity));
        await expect(page.getByText(`1 × 6 kW inverter · ${capacity / 5} × 5 kWh battery modules · ${Math.ceil(capacity / 20)} BMS · LV · Single phase`, { exact: true })).toBeVisible();
      }
      await page
        .getByLabel("BESS configuration", { exact: true })
        .selectOption(quick ? "BESS-24-60" : "BESS-30-40");
      await page
        .getByLabel("Structure", { exact: true })
        .selectOption("Elevated");
      if (!quick) {
        for (const [label, value] of [
          ["6mm² DC cable total (m)", "360"],
          ["Inverter termination · 16 mm² 4-core (m)", "15"],
          ["Panel termination · 25 mm² 4-core (m)", "20"],
          ["2.5mm² earth cable (m)", "20"],
          ["6mm² earth cable (m)", "90"],
          ["10mm² earth cable (m)", "90"],
        ])
          await page.getByLabel(label, { exact: true }).fill(value);
        await page
          .getByLabel("Extra smart meter", { exact: true })
          .selectOption("yes");
        await page
          .getByLabel("Genset synchronisation", { exact: true })
          .selectOption("yes");
      } else {
        await expect(page.getByText("174.15 m", { exact: true })).toHaveCount(
          2,
        );
        await expect(
          page.getByText(
            /2 × 12 kW inverter · 12 × 5 kWh battery modules · 4 BMS/,
          ),
        ).toBeVisible();
      }
      for (const [field, label] of [
        ["Solar Panel brand", "Any of the Above"],
        ["Inverter brand", "Chint Power"],
        ["Battery & BMS brand", "Chint Power"],
        ["Cable brand", "Newage Cables"],
        ["Switchgear brand", "CHINT"],
      ])
        await page.getByLabel(field, { exact: true }).selectOption({ label });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/atif-${suffix}-form-mobile.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await button(
        page,
        quick ? "Save general BOQ draft" : "Save survey draft",
      ).click();
      await expect(page.getByRole("status")).toContainText(
        "Survey draft saved",
      );
      await button(page, "Back to BOQs").click();
      await page
        .getByRole("button", {
          name: quick ? /Skardu -2520/ : /Coordinator validation 90901/,
        })
        .click();
      await expect(
        page.getByLabel("Panel quantity", { exact: true }),
      ).toHaveValue("60");
      await button(page, "Calculate & review BOQ").click();
      if (!quick)
        await expect(
          page.getByText("PKR 6,456,786.00", { exact: true }),
        ).toBeVisible();
      const submitResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/boqs/reviews") &&
          r.request().method() === "POST",
      );
      await button(page, "Submit for review").click();
      const review = await (await submitResponse).json();
      const session = await (
        await page.request.get("/api/auth/session")
      ).json();
      const h = { Origin: origin, "X-CSRF-Token": session.csrfToken };
      expect(
        (
          await page.request.post(`/api/boqs/reviews/${review.id}/decision`, {
            headers: h,
            data: { outcome: "Approved", comments: "" },
          })
        ).status(),
      ).toBe(403);
      await login(manager, `director-${suffix}@example.test`);
      await manager.getByRole("button", { name: /Costing review/ }).click();
      await manager
        .getByRole("row", {
          name: quick ? /Skardu -2520/ : /Coordinator validation 90901/,
        })
        .getByRole("button", { name: "Open workflow" })
        .click();
      await manager
        .getByLabel("Approval quotation format")
        .selectOption(quick ? "No Breakup" : "Full Breakup");
      await manager
        .getByLabel("Approval tax display")
        .selectOption(quick ? "Tax Included" : "Show Sales Tax Separately");
      for (const label of [
        "Solar",
        "Structure",
        "BESS",
        "Earthing",
        "Balance of systems",
        "Other items",
      ])
        await manager
          .getByLabel(`Approval ${label} markup %`, { exact: true })
          .fill("20");
      await manager
        .getByLabel("Instructions for quotation")
        .fill("Approved engineering, use the recorded margins.");
      await button(manager, "Approve & send to Coordinator").click();
      await expect(
        manager.getByRole("heading", { name: /BAFL-.*-R0/ }),
      ).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: /Quotation preparation/ }).click();
      await page
        .getByRole("row", {
          name: quick ? /Skardu -2520/ : /Coordinator validation 90901/,
        })
        .getByRole("button", { name: "Open workflow" })
        .click();
      await expect(page.getByLabel("Approved BOQ revision")).not.toHaveValue(
        "",
      );
      const revisionId = await page
        .getByLabel("Approved BOQ revision")
        .inputValue();
      await button(page, "Calculate selling price").click();
      await button(page, "Save pricing version").click();
      await button(page, "Prepare quotation").click();
      await expect(
        page.locator(".quotation-pdf-pages canvas").first(),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/atif-${suffix}-quotation-desktop.png`,
        fullPage: true,
      });
      const net = await page.locator(".pdf-inline-net").innerText();
      await page
        .getByLabel("Quotation discount (PKR)", { exact: true })
        .fill("1000");
      await expect(page.locator(".pdf-inline-net")).not.toHaveText(net);
      await page
        .getByLabel("Quotation discount (PKR)", { exact: true })
        .fill("");
      await expect(page.locator(".pdf-inline-net")).toHaveText(net);
      const description = page.locator(".quote-description textarea").first();
      await description.fill(
        (await description.inputValue()) + " — verified customer wording",
      );
      await expect(
        page.locator(".quotation-pdf-pages canvas").first(),
      ).toBeVisible();
      await page
        .getByLabel("Quotation discount (PKR)", { exact: true })
        .fill("1000");
      await button(page, "Confirm quotation totals").click();
      await button(page, "Save and send for approval").click();
      await expect(
        page.getByRole("heading", {
          name: /Quotation workflow · Submitted/,
        }),
      ).toBeVisible();
      const href = (await page
        .getByRole("link", { name: "Download quotation PDF", exact: true })
        .getAttribute("href"))!;
      const quoteId = href.split("/").at(-2)!;
      const savedQuotation = await (
        await page.request.get(`/api/commercial/quotations/${quoteId}`)
      ).json();
      expect(savedQuotation.boq_revision_id).toBe(revisionId);
      const dw = page.waitForEvent("download");
      await page
        .getByRole("link", { name: "Download quotation PDF", exact: true })
        .click();
      expect(
        (await readFile((await (await dw).path())!)).subarray(0, 5).toString(),
      ).toBe("%PDF-");
      expect(
        (
          await page.request.post("/api/coordinator/events", {
            headers: h,
            data: { quotationId: quoteId, kind: "Approved" },
          })
        ).status(),
      ).toBe(403);
      const otherLogin = await outsiderContext.request.post("/api/auth/login", {
        headers: { Origin: origin },
        data: {
          email: `other-${suffix}@example.test`,
          password: employeePassword,
        },
      });
      expect(otherLogin.ok()).toBe(true);
      for (const path of [
        `/api/boqs/${revisionId}`,
        `/api/boqs/${revisionId}/costing.pdf`,
        `/api/commercial/quotations/${quoteId}`,
        href,
      ])
        expect((await outsiderContext.request.get(path)).status()).toBe(404);
      await button(manager, "Dashboard").click();
      await manager.getByRole("button", { name: /Quotation approval/ }).click();
      await manager
        .getByRole("row", {
          name: new RegExp(quick ? "BAFL-2520" : "BAFL-90901"),
        })
        .getByRole("button", { name: "Open workflow" })
        .click();
      await button(manager, "Approve quotation").click();
      await manager
        .getByRole("dialog")
        .getByRole("button", { name: "Confirm and send", exact: true })
        .click();
      await expect(
        manager.getByRole("heading", {
          name: "Quotation workflow · Approved",
          exact: true,
        }),
      ).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: /Customer confirmation/ }).click();
      page.on("dialog", async (d) => {
        if (d.type() === "prompt")
          await d.accept("Isolated written acceptance received");
      });
      await page
        .getByRole("row", {
          name: new RegExp(quick ? "BAFL-2520" : "BAFL-90901"),
        })
        .getByRole("button", { name: "Record PO / approval received" })
        .click();
      await page.getByRole("button", { name: /IPO preparation/ }).click();
      await page
        .getByRole("row", {
          name: new RegExp(quick ? "BAFL-2520" : "BAFL-90901"),
        })
        .getByRole("button", { name: "Open workflow" })
        .click();
      await expect(page.getByLabel("Accepted quotation")).toHaveValue(quoteId);
      await page
        .getByLabel("Sale confirmation type")
        .selectOption("Verbal sale confirmation");
      await page
        .getByLabel("Approval evidence / verbal confirmation details")
        .fill("Isolated exact accepted quotation approval recorded for test.");
      await page.getByLabel(/Sale has been confirmed against/).check();
      await button(page, "Review IPO").click();
      await button(page, "Submit evidence for IPO approval").click();
      await expect(
        page.getByRole("heading", {
          name: "IPO submission · Awaiting evidence approval",
        }),
      ).toBeVisible();
      await button(manager, "Dashboard").click();
      await manager.getByRole("button", { name: /IPO approval/ }).click();
      await manager
        .getByRole("row", {
          name: new RegExp(quick ? "BAFL-2520" : "BAFL-90901"),
        })
        .getByRole("button", { name: "Open workflow" })
        .click();
      await button(manager, "Approve evidence & save IPO").click();
      await expect(
        manager.getByRole("heading", { name: /IPO-.*Saved IPO/ }),
      ).toBeVisible();
      await page.reload();
      await page
        .getByRole("button", { name: /Operations & Accounts Handoff/ })
        .click();
      await page
        .getByRole("row", { name: new RegExp(quick ? "2520" : "90901") })
        .getByRole("button", { name: "Open workflow" })
        .click();
      const pack = page.waitForEvent("download");
      await button(page, "Download IPO & Peachtree PDF").click();
      expect((await pack).suggestedFilename()).toContain("IPO-and-Peachtree");
      await button(page, "Send IPO to Accounts").click();
      await expect(page.getByRole("status")).toContainText("Sent to Accounts");
      await page
        .getByLabel("Instructions to Operations")
        .fill("Approved requirements, collect delivery details in Operations.");
      await button(page, "Send BOQ to Operations").click();
      await expect(
        page.getByRole("heading", { name: /^OPS-BOQ-/ }),
      ).toBeVisible();
      await button(page, "Dashboard").click();
      await expect(
        page.getByRole("heading", { name: "Pending tasks (0)", exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/atif-${suffix}-completed-mobile.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    } finally {
      await adminContext.close();
      await managerContext.close();
      await outsiderContext.close();
    }
  });
}
