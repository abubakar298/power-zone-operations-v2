import { test, expect } from '@playwright/test';

test('Notification bell resolves authorized C&I approval, preserves direct links and works on mobile', async ({page, browser}) => {
  const origin = `http://127.0.0.1:${process.env.PZ_E2E_PORT ?? '3180'}`;
  const password = 'browser-test-passphrase-298';
  expect((await page.request.post('/api/auth/setup', {headers:{Origin:origin},data:{email:'notifications-admin@example.test',displayName:'Notification Administrator',password,setupToken:'browser-test-setup-key-isolated-only'}})).status()).toBe(201);
  const adminLogin=await page.request.post('/api/auth/login',{headers:{Origin:origin},data:{email:'notifications-admin@example.test',password}});
  expect(adminLogin.ok()).toBeTruthy();
  const adminHeaders={Origin:origin,'X-CSRF-Token':(await adminLogin.json()).csrfToken};
  expect((await page.request.post('/api/accounts/create',{headers:adminHeaders,data:{email:'notifications-coordinator@example.test',displayName:'Notification Coordinator',role:'Coordinator',password,newPassword:password,confirmPassword:password}})).status()).toBe(201);
  const coordinatorContext=await browser.newContext();
  const coordinator=await coordinatorContext.newPage();
  try {
    const login=await coordinator.request.post('/api/auth/login',{headers:{Origin:origin},data:{email:'notifications-coordinator@example.test',password}});
    const headers={Origin:origin,'X-CSRF-Token':(await login.json()).csrfToken};
    const created=await coordinator.request.post('/api/cni/',{headers,data:{customerId:3,siteName:'Notification browser site',quantity:1,presentation:'Inclusive',discount:'0'}});
    expect(created.status(),await created.text()).toBe(201);
    const proposal=await created.json();
    await page.goto('/dashboard');
    await expect.poll(async()=>{
      const inbox=await (await page.request.get('/api/notifications')).json();
      return inbox.notifications.find((n:any)=>n.target.id===proposal.id)?.id;
    },{timeout:20000}).toBeTruthy();
    const inbox=await (await page.request.get('/api/notifications')).json();
    const notice=inbox.notifications.find((n:any)=>n.target.id===proposal.id);
    await page.reload();
    await page.getByRole('button',{name:/Notifications, \d+ unread/}).click();
    await expect(page.getByRole('heading',{name:'Notifications',exact:true})).toBeVisible();
    await expect(page.getByText('Quotation approval required',{exact:true})).toBeVisible();
    await expect(page.getByText(/Notification browser site/).first()).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'test-results/notification-center-mobile.png',fullPage:true});
    await page.goto(`/dashboard#notification=${notice.id}`);
    await expect(page.getByRole('heading',{name:"C&I quotation review",exact:true})).toBeVisible();
    expect((await (await page.request.get('/api/notifications')).json()).unreadCount).toBe(0);
    await page.reload();
    await expect(page.getByRole('button',{name:/Notifications, 0 unread/})).toBeVisible();
    expect((await coordinator.request.get('/api/notifications/settings')).status()).toBe(403);
    expect((await coordinator.request.get(`/api/notifications/item/${notice.id}`)).status()).toBe(404);
  } finally {await coordinatorContext.close();}
});
