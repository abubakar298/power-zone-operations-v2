import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {Decimal} from 'decimal.js';
import {actors,login,seedQuote,survey,openSavedQuote,password,origin} from './release-fixtures.js';
import {openWorkspaceSection,signOut} from './navigation.js';
test.beforeEach(async({page})=>{page.on('dialog',async dialog=>{if(['confirm','beforeunload'].includes(dialog.type()))await dialog.accept();});});
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
  const passwordInput = page.getByLabel("Password", { exact: true });
  await expect(passwordInput).toHaveAttribute("type", "password");
  await page.getByLabel("Show password", { exact: true }).check();
  await expect(passwordInput).toHaveAttribute("type", "text");
  await expect(passwordInput).toHaveValue("incorrect");
  await page.getByLabel("Show password", { exact: true }).uncheck();
  await expect(passwordInput).toHaveAttribute("type", "password");
  await expect(passwordInput).toHaveValue("incorrect");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Email or password is incorrect.",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-passphrase-298");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Management approvals" }),
  ).toBeVisible();
  await expect(page.getByRole('button',{name:'Dashboard',exact:true})).toHaveAttribute('aria-current','page');
  const upsBucket=page.getByRole('button',{name:/^UBL UPS 209 IPOs received/});
  await expect(upsBucket).toBeVisible();
  await upsBucket.click();
  await expect(page.getByRole('region',{name:'UBL UPS received POs'})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Installed \(\d+\)$/,exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Mapping \/ status flags/}).click();
  await page.getByRole('searchbox',{name:'Search received POs'}).fill('Pull Wasil');
  await expect(page.getByRole('cell',{name:'Pull Wasil, Multan',exact:false})).toBeVisible();
  await expect(page.getByText('Link held for review',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Meezan UPS · 6 \+ 10 /}).click();
  await expect(page.getByRole('region',{name:'Meezan UPS · 6 + 10 received POs'})).toBeVisible();
  await expect(page.getByRole('cell',{name:/233/})).toHaveCount(3);
  await openWorkspaceSection(page, 'Dashboard');
  await expect(page.getByRole('region',{name:'Meezan UPS · 6 + 10 received POs'})).toHaveCount(0);
  await openWorkspaceSection(page, 'My account');
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  await openWorkspaceSection(page, 'Dashboard');
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await openWorkspaceSection(page, 'Master data');
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
  await page.getByRole("tab", { name: /Items & specifications \d+/ }).click();
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
  await openWorkspaceSection(page, 'Dashboard');
  await openWorkspaceSection(page, 'Team access');
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Email activation pending.", { exact: false }),
  ).toBeVisible();
  const cookie=(await context.cookies()).find(c=>c.name==='pz_session')?.value;
  const controlPath=`.local/e2e-control-${process.env.PZ_E2E_PORT??'3180'}.json`;
  const control=JSON.parse(await readFile(controlPath,'utf8'));process.kill(control.pid,'SIGUSR2');
  await expect.poll(async()=>JSON.parse(await readFile(controlPath,'utf8')).generation,{timeout:30000}).toBeGreaterThan(control.generation);
  await page.reload();await expect(page.getByRole('heading',{name:'Team access',exact:true}).first()).toBeVisible();await openWorkspaceSection(page,'Dashboard');await expect(page.getByRole('region',{name:'Management approvals'})).toBeVisible();
  expect((await context.cookies()).find(c=>c.name==='pz_session')?.value).toBe(cookie);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await signOut(page);await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  expect((await context.request.get('/api/dashboard',{headers:{Cookie:`pz_session=${cookie}`}})).status()).toBe(401);
  await page.getByLabel('Email address').fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('region',{name:'Management approvals'})).toBeVisible();expect(errors).toEqual([]);
});

test('standard quotation rows and subtotal retain the saved selling prices; original and six-format PDFs download',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');
 const {quote,pricing}=await seedQuote(page.request,headers,'ROWS');await openSavedQuote(page,quote.number);
 const detail=await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json();
 const expected=pricing.snapshot.rows.reduce((sum:Decimal,row:any)=>sum.add(row.beforeTax).add(new Decimal(row.beforeTax).mul(row.taxRate).div(100)),new Decimal(0)).toFixed(2);
 expect(detail.snapshot.footer.find((r:any)=>r.label==='Total').amount).toBe(expected);
 const original=JSON.stringify(detail.snapshot);const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download quotation PDF',exact:true}).click();
 expect((await readFile((await(await download).path())!)).subarray(0,5).toString()).toBe('%PDF-');
 const formats=await page.request.get(`/api/commercial/quotations/${quote.id}/comparison.pdf`);expect(formats.ok()).toBe(true);expect((await formats.body()).subarray(0,5).toString()).toBe('%PDF-');
 expect(JSON.stringify((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot)).toBe(original);
});

test('Management reviews the exact submitted quotation without changing its saved financial snapshot',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');const {quote}=await seedQuote(page.request,headers,'MGMT',true);
 await login(page.request);await page.goto('/dashboard');await page.getByRole('button',{name:/^Quotations /}).click();
 await expect(page.getByRole('row').filter({hasText:quote.number})).toBeVisible();
 const before=await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json();
 await openSavedQuote(page,quote.number);await expect(page.getByRole('heading',{name:/Quotation workflow/})).toBeVisible();
 expect(JSON.stringify((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot)).toBe(JSON.stringify(before.snapshot));
});

test('Coordinator can embed a revision discount, save it, export all six formats and retain its payable',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');const {quote}=await seedQuote(page.request,headers,'EMBED',false,'1000');
 await openSavedQuote(page,quote.number);await page.getByRole('button',{name:'Create new quotation version',exact:true}).click();
 await page.getByLabel('Revision reason',{exact:true}).fill('Customer requests the approved discount in item prices');await page.getByLabel('Requires costing change').selectOption('no');
 await page.getByRole('button',{name:'Start revision',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm and send',exact:true}).click();
 await page.getByRole('button',{name:'Back to Quotation Settings',exact:true}).click();
 await expect(page.getByLabel('Discount (%)',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Add discount to selling price')).toBeVisible();
 await page.getByLabel('Add discount to selling price').check();
 await page.getByLabel('Discount (%)',{exact:true}).fill('1.0');
 await expect(page.getByRole('button',{name:'Preview Quotation',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Preview Quotation',exact:true}).click();await expect(page.locator('.quotation-pdf-pages canvas').first()).toBeVisible();
 await expect(page.getByLabel('Quotation discount (PKR)',{exact:true})).toHaveCount(0);
 const acknowledgement=page.getByLabel('I have reviewed and acknowledge the change in payable.');if(await acknowledgement.isVisible())await acknowledgement.check();
 const save=page.waitForResponse(r=>r.url().endsWith('/api/commercial/quotations')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Save Revision',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/^Save Revision$|Confirm and send/}).click();
 const savedResponse=await save;expect(savedResponse.ok(),await savedResponse.text()).toBe(true);const saved=await savedResponse.json();
 expect(saved.snapshot.discountPresentation).toBe('included-in-selling-prices');expect(saved.snapshot.footer.some((r:any)=>/Discount/.test(r.label))).toBe(false);
 const original=JSON.stringify(saved.snapshot);const exportPdf=await page.request.get(`/api/commercial/quotations/${saved.id}/comparison.pdf`);expect(exportPdf.ok(),await exportPdf.text()).toBe(true);
 expect(JSON.stringify((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).snapshot)).toBe(JSON.stringify(quote.snapshot));
 expect(JSON.stringify((await(await page.request.get(`/api/commercial/quotations/${saved.id}`)).json()).snapshot)).toBe(original);
});

test('Inventory, Accounts and Design retain isolated workspaces and cannot open commercial administration',async({page})=>{
 await actors(page.request);
 for(const role of ['Inventory','Accounts','Design']){
  await login(page.request,role.toLowerCase()+'-release@example.test');await page.goto('/dashboard');await expect(page.locator('.account-trigger')).toContainText(role);
  for(const path of ['/api/accounts','/api/backups','/api/commercial/standard-policy'])expect((await page.request.get(path)).status()).toBe(403);
  expect((await page.request.get('/api/departments/'+(role==='Inventory'?'Accounts':'Inventory'))).status()).toBe(403);
 }
});

test('external approval requires exact saved quotation evidence and does not expose BESS costs',async({page})=>{
 await actors(page.request);const headers=await login(page.request,'coordinator-release@example.test');const {quote,boq}=await seedQuote(page.request,headers,'EVIDENCE');
 const visible=await(await page.request.get(`/api/boqs/${boq.id}`)).json();expect(visible.snapshot.costVisibility).toBe('Excluding BESS');expect(visible.snapshot.lines.filter((l:any)=>l.costRestricted).every((l:any)=>l.rate===null&&l.total===null)).toBe(true);
 await openSavedQuote(page,quote.number);await page.getByText('Use Management-approved discount instruction',{exact:true}).click();
 await page.getByLabel('Approver name',{exact:true}).fill('Director Operations');await page.getByLabel('Approval remarks',{exact:true}).fill('Approved this exact saved version.');
 await page.getByRole('form',{name:'WhatsApp approval evidence'}).locator('input[type=file]').setInputFiles({name:'approval.png',mimeType:'image/png',buffer:await page.screenshot()});
 await expect(page.getByText('approval.png',{exact:true})).toBeVisible();
 await page.getByLabel('I confirm this evidence approves this exact document without changes.').check();await page.getByRole('button',{name:'Record approval & continue',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm and send',exact:true}).click();
 await expect(page.getByRole('region',{name:'Recorded external approval'})).toBeVisible();expect((await(await page.request.get(`/api/commercial/quotations/${quote.id}`)).json()).workflow_status).toBe('Approved');
});

test('new BOQ draft keeps its measured quantities after saving and reopening on mobile',async({page})=>{
 await actors(page.request);await login(page.request);await page.goto('/dashboard');await openWorkspaceSection(page,'Survey & BOQ');await page.getByRole('button',{name:'New BOQ',exact:true}).click();
 await page.getByLabel('Customer',{exact:true}).fill('Alfalah');await page.getByRole('option',{name:/Alfalah/}).click();await page.getByLabel('New site name',{exact:true}).fill('Draft preservation 22301');
 await page.locator('summary').filter({hasText:'2 · Survey Quantities & Solution'}).click();await page.getByLabel('Panel quantity',{exact:true}).fill('60');await page.getByLabel('Panel wattage (W)',{exact:true}).fill('645');
 await page.getByRole('button',{name:'Save BOQ Draft',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Survey draft saved'})).toBeVisible();await expect(page.getByLabel('Panel quantity',{exact:true})).toHaveValue('60');
 await page.getByRole('button',{name:'Back to BOQs',exact:true}).click();await page.getByRole('button',{name:/Draft preservation 22301/}).click();await expect(page.getByLabel('Panel quantity',{exact:true})).toHaveValue('60');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("Admin downloads an encrypted recovery backup and clears passphrases after download", async ({
  page,
}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? "3180"}`;
  expect(
    (
      await page.request.post("/api/auth/login", {
        headers: { Origin: origin },
        data: {
          email: "admin@example.test",
          password: "browser-test-passphrase-298",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/dashboard");
  await openWorkspaceSection(page, 'Team access');
  const panel = page.locator(".backup-panel");
  await expect(
    panel.getByRole("heading", { name: "Encrypted database backups" }),
  ).toBeVisible();
  await panel
    .getByLabel("Backup administrator password", { exact: true })
    .fill("browser-test-passphrase-298");
  await panel
    .getByLabel("Backup encryption passphrase", { exact: true })
    .fill("ABCdef1234567890!");
  await panel
    .getByLabel("Confirm backup passphrase", { exact: true })
    .fill("ABCdef1234567890!");
  await expect(
    panel.getByText("Backup passphrase: 17 characters · minimum 16"),
  ).toBeVisible();
  await panel
    .getByLabel("Confirm backup passphrase", { exact: true })
    .fill("ABCdef1234567");
  await panel
    .getByRole("button", { name: "Download encrypted backup", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "Confirm backup passphrase has 13 characters",
  );
  await panel
    .getByLabel("Confirm backup passphrase", { exact: true })
    .fill("ABCdef1234567890!");
  const pending = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download encrypted backup", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^Power-Zone-Backup-.*\.pzb$/);
  const { decodeBackup } = await import("../../server/backups/archive.js");
  const records = await decodeBackup(
    (await download.path())!,
    "ABCdef1234567890!",
  );
  expect(JSON.parse(records[0]).format).toBe("power-zone-database-v1");
  expect(records.some((r) => r.includes('"table":"quotation_versions"'))).toBe(
    true,
  );
  await expect(
    panel.getByLabel("Backup encryption passphrase", { exact: true }),
  ).toHaveValue("");
  await expect(panel.getByRole("status")).toContainText("download started");
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await panel.evaluate((el) => ({
    left: el.getBoundingClientRect().left,
    right: el.getBoundingClientRect().right,
    width: window.innerWidth,
  }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  await panel.screenshot({ path: "test-results/admin-backup-panel.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
});
