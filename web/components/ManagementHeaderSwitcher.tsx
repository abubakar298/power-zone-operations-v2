import {useEffect,useState} from 'react';
import {api,type Session} from '../api.js';
import {clearDepartmentUser,departmentContext} from '../department-view.js';
import {confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import {canViewDepartments,type ManagementDepartment} from '../workspaces/management-departments.js';
import {DepartmentViewSwitcher} from './DepartmentViewSwitcher.js';

/** Other module shells use Dashboard's audited selection flow, not their own copy. */
export function ManagementHeaderSwitcher({session,value,operationsArea='operations'}:{session:Session;value?:ManagementDepartment;operationsArea?:'operations'|'procurement'}){
 const [principal,setPrincipal]=useState<Session|undefined>(()=>canViewDepartments(session.user.role)?session:undefined);
 useEffect(()=>{let live=true;if(canViewDepartments(session.user.role))setPrincipal(session);else if(departmentContext())void api<Session>('/auth/session').then(s=>{if(live)setPrincipal(canViewDepartments(s.user.role)?s:undefined);}).catch(()=>{if(live)setPrincipal(undefined);});else setPrincipal(undefined);return()=>{live=false;};},[session.user.id,session.user.role]);
 if(!principal)return null;
 function open(destination:ManagementDepartment|'dashboard',area:'operations'|'procurement'='operations'){
  if(!principal||!confirmLeaveWorkspace())return false;
  sessionStorage.setItem('pz:management-switch-intent',JSON.stringify({principalId:principal.user.id,destination,area}));
  clearDepartmentUser();sessionStorage.removeItem('pz:management-procurement');
  location.assign('/dashboard');return true;
 }
 return <DepartmentViewSwitcher role={principal.user.role} value={value} operationsArea={operationsArea} onSelect={open} onProcurement={()=>open('operations','procurement')}/>;
}
