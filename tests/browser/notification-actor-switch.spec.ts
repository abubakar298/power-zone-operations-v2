import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { actors, login } from './release-fixtures.js';
import { NotificationsRepository } from '../../server/notifications/repository.js';

test('Management View as Accounts discards an older principal inbox response', async ({page, browser}) => {
  await actors(page.request);
  const fixture = JSON.parse(await readFile(`.local/e2e-fixture-${process.env.PZ_E2E_PORT ?? '3180'}.json`, 'utf8'));
  expect(fixture.marker).toBe('power-zone-disposable-browser-fixture-v1');
  expect(new URL(fixture.databaseUrl).hostname).toBe('127.0.0.1');
  const pool = new pg.Pool({connectionString:fixture.databaseUrl,max:2});
  const coordinatorContext = await browser.newContext();
  let releaseStale = () => {};
  try {
    const users = (await pool.query("SELECT id,email,role FROM users WHERE email IN ('admin@example.test','management-release@example.test','accounts-release@example.test')")).rows;
    const management = users.find(u => u.role === 'Management');
    const accounts = users.find(u => u.role === 'Accounts');
    const admin = users.find(u => u.email === 'admin@example.test');
    const coordinator = await coordinatorContext.newPage();
    const coordinatorHeaders = await login(coordinator.request,'coordinator-release@example.test');
    const created = await coordinator.request.post('/api/cni/',{headers:coordinatorHeaders,data:{customerId:3,siteCode:'PRIVATE-BELL',siteName:'Management private bell evidence',quantity:1,presentation:'Inclusive',discount:'0'}});
    expect(created.status(),await created.text()).toBe(201);
    const proposal = await created.json();
    const audit = (await pool.query("INSERT INTO audit_log(user_id,target_user_id,action) VALUES($1,$2,'account.reset.completed') RETURNING id",[admin.id,accounts.id])).rows[0];
    await new NotificationsRepository(pool).sync();
    const managementNotice = (await pool.query('SELECT id,read_at FROM notifications WHERE user_id=$1 AND target->>\'id\'=$2',[management.id,proposal.id])).rows[0];
    const accountsNotice = (await pool.query('SELECT id FROM notifications WHERE user_id=$1 AND source_key=$2',[accounts.id,'security:'+audit.id])).rows[0];
    expect(managementNotice.read_at).toBeNull();
    expect(accountsNotice).toBeTruthy();
    await login(page.request,'management-release@example.test');
    await page.goto('/dashboard');
    await expect(page.getByRole('button',{name:/Notifications, [1-9]\d* unread/})).toBeVisible();

    let captured!: () => void;
    const staleCaptured = new Promise<void>(resolve => { captured = resolve; });
    const held = new Promise<void>(resolve => { releaseStale = resolve; });
    let holdNext = true;
    await page.route('**/api/notifications',async route => {
      if (!holdNext) { await route.continue(); return; }
      holdNext = false;
      const response = await route.fetch();
      const oldInbox = await response.json();
      expect(oldInbox.notifications.some((n:any) => n.id === managementNotice.id)).toBe(true);
      captured();
      await held;
      await route.fulfill({response});
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await staleCaptured;
    const accountsLoaded = page.waitForResponse(async response => {
      if (!response.url().endsWith('/api/notifications') || response.request().headers()['x-pz-department-user'] !== accounts.id) return false;
      return (await response.json()).notifications.some((n:any) => n.id === accountsNotice.id);
    });
    await page.getByRole('button',{name:'View as',exact:true}).click();
    await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Accounts',exact:true}).click();
    const accountsInbox = await (await accountsLoaded).json();
    await expect(page.getByRole('button',{name:'View as',exact:true})).toHaveAttribute('title','Current view: Accounts');
    await expect(page.getByRole('button',{name:`Notifications, ${accountsInbox.unreadCount} unread`,exact:true})).toBeVisible();
    releaseStale();
    await page.unrouteAll({behavior:'wait'});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('button',{name:`Notifications, ${accountsInbox.unreadCount} unread`,exact:true})).toBeVisible();
    // Only opening the new actor's bell may acknowledge that actor's inbox.
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[managementNotice.id])).rows[0].read_at).toBeNull();
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[accountsNotice.id])).rows[0].read_at).toBeNull();
    await page.getByRole('button',{name:/Notifications, \d+ unread/}).click();
    await expect(page.getByRole('button',{name:'Notifications, 0 unread',exact:true})).toBeVisible();
    await expect(page.locator('.notification-panel')).toContainText('Password changed');
    await expect(page.locator('.notification-panel')).not.toContainText('Management private bell evidence');
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[managementNotice.id])).rows[0].read_at).toBeNull();
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[accountsNotice.id])).rows[0].read_at).toBeTruthy();
    expect((await page.request.get(`/api/notifications/item/${managementNotice.id}`,{headers:{'X-PZ-Department-User':accounts.id,'X-PZ-Management-User':management.id}})).status()).toBe(404);
    expect((await pool.query('SELECT id,role FROM users WHERE id=ANY($1::uuid[]) ORDER BY id',[users.map(u=>u.id)])).rows).toEqual(users.map(({id,role})=>({id,role})).sort((a,b)=>a.id.localeCompare(b.id)));
  } finally {
    releaseStale();
    await page.unrouteAll({behavior:'wait'});
    await coordinatorContext.close();
    await pool.end();
  }
});
