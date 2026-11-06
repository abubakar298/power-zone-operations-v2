/**
 * Batch planning: a site's part of a batch is finished once its installation documents
 * (customer acknowledgement & variable sign-off, not the delivery DO) have reached the
 * Karachi office. Documents already submitted to Accounts have passed Karachi too.
 * Display only: the saved batch and the site are never changed.
 */
const installationDocument=(siteId:string,id:unknown)=>id===`${siteId}:completion-documents`||id===`${siteId}:historical-handover-documents`;
export function installationDocumentsAtKarachi(siteId:string,site:any):boolean{
 return (Array.isArray(site?.documents)?site.documents:[]).some((d:any)=>installationDocument(siteId,d?.id)&&(
  d.location==='Received at Karachi office'||d.location==='Submitted to Accounts'||d.submittedToAccounts===true||!!d.submittedToAccountsAt));
}
