import {syncFixtureNotifications} from './release-fixtures.js';
import { test, expect } from '@playwright/test';

test('Opening either notification bell persists acknowledgment, retains history and keeps later notices unread', async ({page, browser}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? '3180'}`;
  const password = 'browser-test-passphrase-298';
  expect((await page.request.post('/api/auth/setup', {headers:{Origin:origin},data:{email:'bell-admin@example.test',displayName:'Bell Administrator',password,setupToken:'browser-test-setup-key-isolated-only'}})).status()).toBe(201);
  const adminLogin = await page.request.post('/api/auth/login',{headers:{Origin:origin},data:{email:'bell-admin@example.test',password}});
  const adminHeaders = {Origin:origin,'X-CSRF-Token':(await adminLogin.json()).csrfToken};
  for (const [email,role] of [['bell-coordinator@example.test','Coordinator'],['bell-management@example.test','Management']]) {
    expect((await page.request.post('/api/accounts/create',{headers:adminHeaders,data:{email,displayName:role,role,password,newPassword:password,confirmPassword:password}})).status()).toBe(201);
  }
  const coordinatorContext = await browser.newContext();
  const managementContext = await browser.newContext();
  try {
    const coordinator = await coordinatorContext.newPage();
    const management = await managementContext.newPage();
    const login = await coordinator.request.post('/api/auth/login',{headers:{Origin:origin},data:{email:'bell-coordinator@example.test',password}});
    const coordinatorHeaders = {Origin:origin,'X-CSRF-Token':(await login.json()).csrfToken};
    expect((await management.request.post('/api/auth/login',{headers:{Origin:origin},data:{email:'bell-management@example.test',password}})).ok()).toBeTruthy();
    let sequence = 0;
    async function proposal() {
      sequence++;
      const created = await coordinator.request.post('/api/cni/',{headers:coordinatorHeaders,data:{customerId:3,siteCode:`BELL-${sequence}`,siteName:`Bell notification site ${sequence}`,quantity:1,presentation:'Inclusive',discount:'0'}});
      expect(created.status(),await created.text()).toBe(201);
      const record = await created.json();
      await syncFixtureNotifications();
      await expect.poll(async () => {
        const inbox = await (await page.request.get('/api/notifications')).json();
        return inbox.notifications.find((n:any) => n.target.id === record.id)?.id;
      },{timeout:20000}).toBeTruthy();
      return record;
    }
    const inbox = async () => (await page.request.get('/api/notifications')).json();
    const otherInbox = async () => (await management.request.get('/api/notifications')).json();
    for (const route of ['/dashboard','/inventory']) {
      const record = await proposal();
      await expect.poll(async () => (await otherInbox()).notifications.some((n:any) => n.target.id === record.id)).toBe(true);
      const otherBefore = await otherInbox();
      await page.goto(route);
      await expect(page.getByRole('button',{name:/Notifications, [1-9]\d* unread/})).toBeVisible();
      const before = await inbox();
      const original = before.notifications.find((n:any) => n.target.id === record.id);
      // Hold an older poll until after the persisted read and fresh inbox.
      let releaseStale!: () => void;
      let sawStale!: () => void;
      const held = new Promise<void>(resolve => { releaseStale = resolve; });
      const captured = new Promise<void>(resolve => { sawStale = resolve; });
      let holdNext = true;
      await page.route('**/api/notifications', async route => {
        if (!holdNext) { await route.continue(); return; }
        holdNext = false;
        const response = await route.fetch();
        sawStale();
        await held;
        await route.fulfill({response});
      });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await captured;
      await page.getByRole('button',{name:/Notifications, \d+ unread/}).click();
      await expect(page.getByRole('button',{name:'Notifications, 0 unread',exact:true})).toBeVisible();
      releaseStale();
      await page.unrouteAll({behavior:'wait'});
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.getByRole('button',{name:'Notifications, 0 unread',exact:true})).toBeVisible();
      const acknowledged = await inbox();
      expect(acknowledged.unreadCount).toBe(0);
      const retained = acknowledged.notifications.find((n:any) => n.id === original.id);
      expect(retained.read_at).toBeTruthy();
      expect(retained.actionable).toBe(original.actionable);
      expect(retained.resolved_at).toBe(original.resolved_at);
      await expect(page.locator('.notice-link').filter({hasText:record.siteName ?? `Bell notification site ${sequence}`})).toBeVisible();
      expect((await otherInbox()).unreadCount).toBe(otherBefore.unreadCount);
      expect((await otherInbox()).notifications.find((n:any) => n.target.id === record.id).read_at).toBeNull();
      await page.reload();
      await expect(page.getByRole('button',{name:'Notifications, 0 unread',exact:true})).toBeVisible();
      const later = await proposal();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByRole('button',{name:'Notifications, 1 unread',exact:true})).toBeVisible();
      expect((await inbox()).notifications.find((n:any) => n.target.id === later.id).read_at).toBeNull();
      // A failed acknowledgment keeps the authoritative badge and exposes retry feedback.
      await page.route('**/api/notifications/read', route => route.abort());
      await page.getByRole('button',{name:'Notifications, 1 unread',exact:true}).click();
      await expect(page.getByText('Could not mark notifications as read.',{exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'Notifications, 1 unread',exact:true})).toBeVisible();
      await page.unroute('**/api/notifications/read');
      await page.getByRole('button',{name:'Mark all as read',exact:true}).click();
      await expect(page.getByRole('button',{name:'Notifications, 0 unread',exact:true})).toBeVisible();
    }
  } finally {
    await coordinatorContext.close();
    await managementContext.close();
  }
});
