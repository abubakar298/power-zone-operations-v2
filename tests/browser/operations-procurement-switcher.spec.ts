import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { actors, login } from './release-fixtures.js';

test('Moaz switches between Operations and Procurement and can raise requests', async ({ page }) => {
  await actors(page.request);
  const fixture = JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT ?? '3180'}.json`, 'utf8'));
  expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');
  expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
  const pool = new pg.Pool({ connectionString: fixture.databaseUrl });
  const email = 'moaz@powerzone.com.pk';
  try {
    await pool.query("INSERT INTO users(id,email,display_name,role,password_hash) SELECT gen_random_uuid(),$1,'Moaz Ahsan','Operations',password_hash FROM users WHERE email='admin@example.test'", [email]);
    await pool.query("INSERT INTO operations_board_access(user_id,kind,granted_by) SELECT m.id,'head',a.id FROM users m CROSS JOIN users a WHERE m.email=$1 AND a.email='admin@example.test'", [email]);
    await pool.query(await readFile('migrations/304_moaz_procurement_access.sql', 'utf8'));
    const headers = await login(page.request, email);
    const access = await (await page.request.get('/api/procurement/me')).json();
    expect(access).toMatchObject({ buyer: true, approver: false, operationsBoard: true });

    await page.goto('/operations/sites');
    const select = async (area: string) => {
      await page.getByRole('button', { name: 'View as', exact: true }).click();
      const menu = page.getByRole('navigation', { name: 'View department workspace' });
      await expect(menu.getByRole('button')).toHaveText(['Procurement', 'Operations']);
      await menu.getByRole('button', { name: area, exact: true }).click();
    };
    await select('Procurement');
    await expect(page.getByRole('heading', { name: 'Stock overview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create request', exact: true })).toBeVisible();
    const created = await page.request.post('/api/procurement/requests', { headers, data: { title: 'Moaz purchase request' } });
    expect(created.status(), await created.text()).toBe(200);
    await select('Operations');
    await expect(page.getByRole('heading', { name: 'Site updates' })).toBeVisible();
  } finally {
    await pool.end();
  }
});
