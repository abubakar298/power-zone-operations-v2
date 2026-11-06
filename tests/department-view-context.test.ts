import {test} from 'node:test';
import assert from 'node:assert/strict';
import {departmentViewHeaders,savedDepartmentUser,saveDepartmentUser,clearDepartmentUser} from '../web/department-view.js';
import type {User} from '../web/api.js';

test('department context excludes authentication and external URLs and is cleared when the principal changes',()=>{
 const storage=new Map<string,string>();
 const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
 try{
  const principal:User={id:'management',email:'management@example.test',displayName:'Management',role:'Management'};
  const target:User={id:'atif',email:'atif@example.test',displayName:'Atif Hameed',role:'Coordinator'};
  saveDepartmentUser(principal,target);
  assert.equal(savedDepartmentUser(principal)?.id,target.id);
  assert.deepEqual(departmentViewHeaders('/orders'),{'X-PZ-Department-User':'atif','X-PZ-Management-User':'management'});
  assert.deepEqual(departmentViewHeaders('/api/orders/1/ipo.pdf'),departmentViewHeaders('/orders'));
  for(const path of ['/auth/session','/api/auth/logout','https://external.example/file.pdf','//external.example/file.pdf','blob:example'])assert.deepEqual(departmentViewHeaders(path),{});
  assert.equal(savedDepartmentUser({...principal,id:'another-manager'}),undefined);
  assert.deepEqual(departmentViewHeaders('/orders'),{});
  saveDepartmentUser(principal,target);
  assert.equal(savedDepartmentUser({...principal,role:'Coordinator'}),undefined);
  clearDepartmentUser();
 }finally{if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);else delete (globalThis as any).sessionStorage;}
});
