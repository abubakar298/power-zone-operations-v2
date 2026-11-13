import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { actors, login } from './release-fixtures.js';

test('Moaz opens view-only BOQ details on an Operations site; other heads do not see it', async ({ page }) => {
  await actors(page.request);
  const fixture = JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT ?? '3180'}.json`, 'utf8'));
  expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');
  expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
  const pool = new pg.Pool({ connectionString: fixture.databaseUrl });
  const moaz = 'moaz@powerzone.com.pk', other = 'boq-other-head@example.test', siteId = 'e2e-boq-site-' + randomUUID();
  try {
    for (const [email, name] of [[moaz, 'Moaz Ahsan'], [other, 'Other Head']]) {
      await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) SELECT gen_random_uuid(),$1,$2,'Operations',password_hash FROM users WHERE email='admin@example.test'", [email, name]);
      await pool.query("INSERT INTO operations_board_access(user_id,kind,granted_by) SELECT m.id,'head',a.id FROM users m CROSS JOIN users a WHERE m.email=$1 AND a.email='admin@example.test' ON CONFLICT DO NOTHING", [email]);
    }
    await pool.query(await readFile('migrations/306_operations_boq_viewers.sql', 'utf8').then(sql => sql.replace(/CREATE TABLE operations_boq_viewers[\s\S]*?\);/, '')));
    const admin = (await pool.query("SELECT id FROM users WHERE email='admin@example.test'")).rows[0].id;
    await pool.query('INSERT INTO operations_board_sites(id,created_by) VALUES($1,$2)', [siteId, admin]);
    await pool.query("INSERT INTO operations_board_versions(site_id,version,snapshot,action,reason,request_key,created_by) VALUES($1,1,$2,'Source imported','E2E BOQ details',$3,$4)", [siteId, { id: siteId, name: 'BOQ details site', ipo: 'IPO-BOQ-1', stage: 'received', documents: [] }, randomUUID(), admin]);

    // Another head: no flag, and the route refuses.
    await login(page.request, other);
    expect((await (await page.request.get('/api/operations-board/sites')).json()).access.boqViewer).toBe(false);
    expect((await page.request.get(`/api/operations-board/sites/${encodeURIComponent(siteId)}/boq`)).status()).toBe(403);
    await page.goto('/operations/sites/' + encodeURIComponent(siteId));
    await expect(page.getByRole('heading', { name: 'BOQ details site' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'BOQ details', exact: true })).toHaveCount(0);

    // Moaz: the button opens the issued item list (mocked items; no link on this test site).
    await login(page.request, moaz);
    expect((await (await page.request.get(`/api/operations-board/sites/${encodeURIComponent(siteId)}/boq`)).json())).toEqual({ linked: false });
    await page.route('**/api/operations-board/sites/*/boq', route => route.fulfill({ json: { linked: true, issuanceNumber: 'FBOQ-1', issuedAt: '2026-11-10T09:00:00.000Z', ipoNumber: 'IPO-BOQ-1', boqNumber: 'PBQ-1', siteName: 'BOQ details site', siteCode: 'S-1', items: [{ description: 'Solar PV Modules', brand: 'Brand A', specification: '585 W', qty: '20', unit: 'No.' }, { description: 'DC cable 6mm', brand: null, specification: null, qty: '150', unit: 'm' }] } }));
    await page.goto('/operations/sites/' + encodeURIComponent(siteId));
    await page.getByRole('button', { name: 'BOQ details', exact: true }).click();
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'BOQ details', exact: true }) });
    await expect(panel).toContainText('BOQ PBQ-1 · IPO IPO-BOQ-1');
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Solar PV Modules');
    await expect(rows.first()).toContainText('20');
    await expect(panel.locator('input, select, textarea')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toHaveCount(0);
  } finally {
    await pool.end();
  }
});
