export const managementDepartments = [
  {view:'coordination',label:'Project Coordination',role:'Coordinator'},
  {view:'design',label:'Design',role:'Design'},
  {view:'finance',label:'Accounts',role:'Accounts'},
  {view:'operations',label:'Operations',role:'Operations'},
  {view:'inventory',label:'Inventory / Store',role:'Inventory'},
] as const;
export type ManagementDepartment = typeof managementDepartments[number]['view'];
export const canViewDepartments=(role:string)=>role==='Admin'||role==='Management';
export const managementDepartment=(view:string|null)=>managementDepartments.find(d=>d.view===view);
