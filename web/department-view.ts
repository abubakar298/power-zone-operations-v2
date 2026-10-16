import type {User} from './api.js';
const key='pz:management-department-view:v1';
type Context={principalId:string;user:User};
export function departmentContext():Context|undefined{try{const c=JSON.parse(sessionStorage.getItem(key)??'null');return c&&typeof c.principalId==='string'&&typeof c.user?.id==='string'?c:undefined;}catch{return undefined;}}
export function savedDepartmentUser(principal:User){const c=departmentContext();if(c&&(!['Management','Admin'].includes(principal.role)||c.principalId!==principal.id)){clearDepartmentUser();return undefined;}return c?.user;}
export function saveDepartmentUser(principal:User,user:User){sessionStorage.setItem(key,JSON.stringify({principalId:principal.id,user}));}
export function clearDepartmentUser(){try{sessionStorage.removeItem(key);}catch{/* Authentication still ends if browser storage is unavailable. */}}
export function departmentViewHeaders(path:string):Record<string,string>{const c=departmentContext();return c&&path.startsWith('/')&&!path.startsWith('//')&&!/^\/?(?:api\/)?auth(?:\/|$)/.test(path)?{'X-PZ-Department-User':c.user.id,'X-PZ-Management-User':c.principalId}:{};}
export function departmentFetch(path:string,options:RequestInit={}){const headers=new Headers(options.headers);for(const[k,v]of Object.entries(departmentViewHeaders(path)))headers.set(k,v);return fetch(path,{...options,headers});}
