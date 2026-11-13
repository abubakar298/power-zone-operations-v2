import {confirmLeaveWorkspace} from '../hooks/useUnsavedChanges.js';
import {DepartmentViewSwitcher} from './DepartmentViewSwitcher.js';

export function OperationsProcurementSwitcher({area}:{area:'operations'|'procurement'}){
 function open(next:typeof area){
  if(next===area)return true;
  if(!confirmLeaveWorkspace())return false;
  location.assign(next==='operations'?'/operations/sites':'/dashboard#workspace=warehouse-stock');
  return true;
 }
 return <DepartmentViewSwitcher role="Operations" value="operations" operationsArea={area}
  operationsAndProcurementOnly onSelect={()=>open('operations')} onProcurement={()=>open('procurement')}/>;
}
