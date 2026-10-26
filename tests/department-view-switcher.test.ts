import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DepartmentViewSwitcher} from '../web/components/DepartmentViewSwitcher.js';
import {canViewDepartments,managementDepartment,managementDepartments} from '../web/workspaces/management-departments.js';
test('department switcher is available only to Management and Admin and retains real workspace routes',()=>{
 for(const role of ['Admin','Management']){assert.equal(canViewDepartments(role),true);assert.match(renderToStaticMarkup(createElement(DepartmentViewSwitcher,{role,onSelect:()=>true})),/View as/);}
 for(const role of ['Coordinator','Design','Accounts','Operations','Inventory','Employee']){assert.equal(canViewDepartments(role),false);assert.equal(renderToStaticMarkup(createElement(DepartmentViewSwitcher,{role,onSelect:()=>true})), '');}
 assert.deepEqual(managementDepartments.map(d=>d.view),['coordination','design','finance','operations','inventory']);
 for(const d of managementDepartments)assert.equal(managementDepartment(d.view),d);
 assert.equal(managementDepartment('unrecognized'),undefined);
 assert.match(renderToStaticMarkup(createElement(DepartmentViewSwitcher,{role:'Management',value:'design',onSelect:()=>true})),/Current view: Design/);
});
