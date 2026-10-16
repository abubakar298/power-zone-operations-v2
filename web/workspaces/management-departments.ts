export const managementDepartments = [
  {view:'coordination',label:'Project Coordination'},
  {view:'design',label:'Design'},
  {view:'finance',label:'Accounts'},
  {view:'operations',label:'Operations'},
  {view:'inventory',label:'Inventory / Store'},
] as const;
export type ManagementDepartment = typeof managementDepartments[number]['view'];
export const canViewDepartments=(role:string)=>role==='Admin'||role==='Management';
export const managementDepartment=(view:string|null)=>managementDepartments.find(d=>d.view===view);
