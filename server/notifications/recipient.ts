/** Recheck the recipient against current role/ownership at delivery time. */
export function notificationRecipientAllowed(row:{audience:string;role:string;owner_id:string|null;user_id:string;kind:string}) {
 return (row.audience==='management'&&['Admin','Management'].includes(row.role)) ||
  (row.audience==='owner'&&row.owner_id===row.user_id&&['Admin','Management','Coordinator'].includes(row.role)) ||
  (['security','assigned'].includes(row.audience)&&row.owner_id===row.user_id) ||
  row.audience===row.role ||
  (row.kind==='Escalation'&&['Admin','Management'].includes(row.role));
}
