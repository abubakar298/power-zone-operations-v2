# Milestone 2 — reviewed master data

Imported the supplied workbook master records: 286 customers (IDs 0–285), four sites, 25 brand selections, 33 rate keys, 21 engineering settings, six inverter configurations and seven costing classifications. Source checksum is stored in master_imports and data/reference-masters.json. Excel's cached 25,150 changeover rate is used; the blank inactive rate is SQL NULL. Rates retain Active / Needs Rate / Inactive independently of their numeric values.

Customers, sites, brands, rates, rules and items have searchable authenticated screens. Only Admin can edit or create customers. Customer short codes are case-insensitively unique. Existing customer IDs and site customer relationships cannot be changed. New sites are deferred to the New BOQ workflow. The handover does not define a Management/Employee master-write matrix, so both roles have read-only access for now.

Rate, rule and technical-specification edits append immutable versions; triggers reject updates/deletes of old versions. Optimistic version checks reject stale edits. Mutations require the authenticated server role, exact Origin, JSON and CSRF; successful writes are audited. Repeat migrations never overwrite edits. No historical BOQ, pricing or quotation transaction is imported or recalculated.

The owner's technical screenshot supplies 24 catalogue records; these remain separate from the 33 costing keys. Eleven clear specification mappings were applied. Four uncertain mappings (100A rotary changeover, 16mm² AC termination, 63A MCB and combined AC/DC boxes) are marked Needs review, retaining source details without replacing locked design rules. Earthing cable wording is preserved exactly as supplied. Missing specifications are marked Need to enter and can be filtered and edited by Admin. Approved status requires nonempty specification text. Specifications belong to costing/store issuance, not automatic quotation descriptions.

No costing engine is implemented in this milestone. The stored reference rates/rules/mappings will be consumed by the later tested BOQ engine. Commercial pricing/tax logic remains governed by the handover and is not activated here.

Employee onboarding work is deferred in local work/deferred-onboarding and excluded from this branch and deployment. Planned sender is abubakar@powerzone.com.pk; email provider configuration is still needed when onboarding resumes.
