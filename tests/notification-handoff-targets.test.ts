import {test} from 'node:test';import assert from 'node:assert/strict';import {notificationPath} from '../shared/notification-target.js';
test('notification destinations allow only named Accounts, Parent DO and scoped Operations routes',()=>{
 for(const path of ['/accounts/ipos','/accounts/inventory','/accounts/documents','/accounts/closures','/accounts/closure-review','/accounts/invoicing','/inventory/parent-dos'])assert.equal(notificationPath({path}),path);
 assert.equal(notificationPath({path:'/operations/sites/live-ipo%3Aid'}),'/operations/sites/live-ipo%3Aid');
 for(const path of ['https://example.test','//example.test','/accounts/team','/accounts/documents?url=bad','/inventory/admin','/operations/sites/..','/operations/sites/x%2fy','/accounts/documents#other'])assert.equal(notificationPath({path}),null);
});
