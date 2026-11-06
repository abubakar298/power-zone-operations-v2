import {test,expect} from '@playwright/test';import {actors,login,password} from './release-fixtures.js';
test('IT support role can be created and opens team workspaces through audited View as without Management access',async({page})=>{
 const headers=await actors(page.request);
 const create=await page.request.post('/api/accounts/create',{headers,data:{email:'it-support@example.test',displayName:'Umar Support Fixture',role:'IT Support',password,newPassword:password,confirmPassword:password}});expect(create.status()).toBe(201);
 await login(page.request,'it-support@example.test');await page.goto('/dashboard');
 await expect(page.getByRole('heading',{name:'IT Support',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'View as',exact:true}).click();await expect(page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Management',exact:true})).toHaveCount(0);
 await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'Design',exact:true}).click();
 await expect(page.getByRole('button',{name:'View as',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'IT Support',exact:true})).toHaveCount(0);
 const real=await(await page.request.get('/api/auth/session')).json();expect(real.user.role).toBe('IT Support');
 await page.getByRole('button',{name:'View as',exact:true}).click();await page.getByRole('navigation',{name:'View department workspace'}).getByRole('button',{name:'IT Support',exact:true}).click();await expect(page.getByRole('heading',{name:'IT Support',exact:true})).toBeVisible();
 await page.screenshot({path:'/tmp/pz-it-support-home.png',fullPage:false});
});
