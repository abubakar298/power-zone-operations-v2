import { ipoInvoiceTerms, type IpoInvoiceTerms } from '../../shared/ipo-invoice-terms.js';
import { projectSiteEvidence } from './site-evidence-projection.js';
import { customerDocumentReferences } from './customer-documents.js';
import { partialSolarInvoiceDate } from './partial-solar-delivery.js';

export function historicalInvoiceTerms(row?: {key?: string; program?: string}): IpoInvoiceTerms | undefined {
  if (row?.program === 'Solar 70' && row.key?.startsWith('UBL:SOLAR:')) return 'partial-delivery-and-completion';
  if (row?.program === 'UPS 250' && row.key?.startsWith('UBL:UPS:')) return 'advance-received-balance-at-completion';
  if (row?.key?.startsWith('MBL:') && /^MBL UPS (20|60|80)$/.test(row.program ?? '')) return 'completion';
}

export function issuedInvoiceTerms(snapshot?: any): IpoInvoiceTerms | undefined {
  const terms = snapshot?.input?.invoiceTerms;
  if (ipoInvoiceTerms.includes(terms)) return terms;
  const configuration = snapshot?.approvedCommercialSource?.key;
  const programmeSize = String(snapshot?.input?.orderNumber ?? '').split('/')[1];
  if (snapshot?.customer?.shortCode === 'UBL' && snapshot.approvedCommercialSource?.type === 'framework' && /^(20-20-30|25-20-30|30-30-40|35-30-40):(Original|Revised)$/.test(configuration ?? ''))
    return 'partial-delivery-and-completion';
  if (configuration === 'UBL-UPS-6-10' && programmeSize === '250') return 'advance-received-balance-at-completion';
  if (/^MBL-UPS-6-(5|10)$/.test(configuration ?? '') && ['20','60','80'].includes(programmeSize)) return 'completion';
  if (snapshot?.customer?.shortCode === 'ELEN' && snapshot.solutionId === 'DIRECT-PRODUCT') return 'delivery';
}

type FileIndex = Map<string, string>;
export function invoiceMilestones(siteId: string, site: any, terms: IpoInvoiceTerms, files: FileIndex, approved?: any) {
  const current = (ref: any) => Boolean(ref?.id && files.has(ref.id));
  const photo = (ref: any) => files.get(ref?.id)?.startsWith('image/') === true;
  const docs = customerDocumentReferences([{site_id:siteId,version:1,snapshot:site}]).filter(doc => files.has(doc.fileId));
  const returnedAt = site.deliveryReturns?.at(-1)?.recordedAt;
  const deliveries = (site.deliveries ?? []).filter((d:any) => !returnedAt || d.recordedAt > returnedAt);
  const history = site.documents?.find((d:any) => d.id === siteId+':historical-delivery-documents');
  const signed = (deliveries.length ? deliveries.every((d:any) => current(d.signedDo)) : !returnedAt && (current(site.signedDo) || current(history?.evidence?.[0])));
  const full = site.partial !== true && (site.stage === 'delivered' || site.stage === 'completed' || site.completed === true);
  const partial = terms === 'partial-delivery-and-completion'
    ? partialSolarInvoiceDate({...site, deliveries:deliveries.filter((d:any)=>current(d.signedDo)), signedDo:current(site.signedDo)?site.signedDo:undefined}, approved)
    : null;
  const evidence = projectSiteEvidence(siteId, site);
  const pictures = evidence.pictureGroups.some(group => group.kind==='installation' && group.files.some(photo));
  return {
    delivery: ['delivery','delivery-and-completion','partial-delivery-and-completion'].includes(terms) && (full && signed || !!partial),
    completion: terms !== 'delivery' && full && (site.completed === true || site.stage === 'completed') && signed &&
      docs.some(doc => doc.kind === 'Acknowledgment') &&
      (evidence.vsoNotRequired || docs.some(doc => doc.kind === 'VSO')) && pictures,
    partial: partial || null,
  };
}
