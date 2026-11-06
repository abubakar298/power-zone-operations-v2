/** One consistent job reference for Accounts, Inventory and Management. */
export function jobLabel(job: any): string {
  const i = job.identity ?? job;
  const code = i.customer_code ?? job.source?.customerCode;
  const site = i.site_name ?? job.title ?? '';
  const name = code === 'UBL' ? site.replace(/^UBL\s+/i, '') : site;
  const branch = i.branch_code ?? job.source?.branchCode;
  const configuration = i.configuration_id ?? job.source?.configuration;
  return [i.job_id ?? job.jobId, code, name, branch ? `(${branch})` : null,
    configuration ? `· ${configuration}` : null].filter(Boolean).join(' ');
}
