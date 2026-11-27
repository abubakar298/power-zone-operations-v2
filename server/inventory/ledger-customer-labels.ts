export const elahiCustomerName = 'Elahi Energies';

export const elahiCustomerAliases = [
  'elen', 'elahi energies', 'elahi energy', 'adnan elahi', 'mr adnan elahi',
  'adnan elahi elahi energy', 'adnan elahi elahi energies',
];

export const elahiSiteAliases = [
  'elahi energy', 'elahi energy faisalabad', 'elahi energy faislabad', 'elahi energy islamabad',
  '148 c1 people colony fsd', '148 c1 people colony faisalabad',
  '148 c1 people colony fsd adnan elahi',
  '148 c1 people colony fsd 148 c1 people colony faisalabad',
];

const normalized = (value?: string | null) =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Resolve the display name without changing the source customer, site or issue. */
export function labelElahiLedgerCustomer<T extends {customer?: string | null; site?: string | null}>(row: T): T {
  const customer = normalized(row.customer);
  const matched = elahiCustomerAliases.includes(customer) ||
    (!customer && elahiSiteAliases.includes(normalized(row.site)));
  return matched ? { ...row, customer: elahiCustomerName } : row;
}
