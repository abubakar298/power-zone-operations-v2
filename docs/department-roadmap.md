# Power Zone department roadmap

Recorded from Abu Bakar's requirements on 6 October 2026. Future scope; does not expand the current quotation-based IPO milestone. KPI formulas, targets, permissions and notification recipients remain to be defined with the owner.

## Operations Coordination

Atif Hameed is the current operations coordinator. This is the first department whose work the application is digitising. Inputs include design department survey reports, leads from salespeople, and direct-sale information from Abu Bakar or salespeople, including inverter/battery-only sales without a quotation or BOQ.

Atif prepares BOQs, costing, quotations, revisions and IPOs, uploads the supporting information, and shares documents with accounts. His responsibility extends through IPO creation and passing the approved BOQ to store. Store issuance prerequisites remain approved quotation/customer sale confirmation and IPO for the implemented quotation-based workflow. Direct-sale exceptions need their own later workflow and must not be inferred from the quotation-based rules.

At the end of this department's functional implementation, create an Operations Coordination dashboard with pending actions and work requiring Atif's attention. Include performance KPIs after their definitions are agreed. Do not invent scoring, thresholds or targets.

## Design

Design supplies survey reports. A dedicated design dashboard is planned; its remaining responsibilities and hand-offs require later definition.

## Procurement

Procurement is another department to integrate later. Its responsibilities, approval rules, hand-offs and dashboard details are not yet defined. Do not infer them from inventory/store responsibilities.

## IPO information and delivery scheduling

Customer details should be extracted from an uploaded PO for employee review. Otherwise contact person/number, billing details and relevant customer information should come from the customer master. NTN/STRN are not universally required for other sale-confirmation types. PO dates should come from the PO; do not invent dates from customer records unless a relevant dated field exists. Delivery date/time is set by Operations. Once scheduled, the approved BOQ can be issued to Inventory so it knows when to prepare stock. This hand-off and PO extraction/autofill need a later implementation check; current IPO still uses reviewed manual fields.

Every IPO should have a Peachtree Division attachment for Accounts, with phases Solar Panels, Structure, Inverter, Batteries, BMS and EPC (all remaining items). Full Breakup retains accepted item prices/markups net of discount. Basic Breakup pools BESS and Balance/EPC profit against their combined costs, derives one effective before-tax markup and redistributes across those phases using their costs; separately priced Solar, Structure and Earthing remain unchanged. Only No Breakup uses a fixed solar cost markup of 10% (cost 100 becomes 110; tax-inclusive solar allocation 121), with remaining value allocated across other phases in proportion to approved phase costs. Tax Separate uses before-tax phase values; Tax Included uses tax-inclusive phase values, preserving tax details separately for reconciliation. This changes the internal phase division, not the accepted quotation or IPO payable. Taxes must remain distinct from actual profit in financial reporting, even for cash receipts.

## Inventory & Store

Inventory includes store. It supports material issuance against approved scope, and later receives installation reports and information about issued material not used at site.

Reports may arrive through WhatsApp before material is physically returned. Record the expected adjustment and communicate it to accounts, while keeping physical stock unchanged until the material is actually received by store/the receiving location. The owner described this as received at site; confirm the precise receiving location when implementing returns. Teams may work across multiple sites and return material weeks later. Preserve job/site attribution, pending returns and the later physical receipt as distinct records. Do not count expected returns as available stock.

## Site Operations & Quality Control

Ensure work follows BOQ quantities and technical specifications, with quality, documentation control and site time efficiency. Supporting records include customer sign-off, customer-signed DOs, site pictures and installation reports. A dedicated dashboard is planned.

## Accounts

Accounts already holds the IPO and receives completion documents from quality control and the installation report/adjustment information from inventory. It verifies any required changes resulting from the installation report before invoicing.

Invoice generation and actual project costing currently remain in accounts' existing software. Their integration is deferred until the preceding operational workflows are established. This application should first integrate the remaining accounts work: document collection/checks, outstanding evidence, review of installation adjustments, hand-offs and job readiness.

Later, compare actual costs supplied from accounts' software against the approved budget associated with the final accepted quotation and exact BOQ/costing revision. Save and review that comparison. Accounts closes the job in its own software. The future integration should reflect closure and notify the appropriate people if a later expense is entered; recipients and the external system's enforcement capabilities require definition. Do not claim this application can block expenses in an unintegrated external system.

## Dashboards and reporting

Plan dedicated dashboards for Operations Coordination, Design, Inventory & Store, Site Operations & Quality Control, Accounts, master/administration, and Executives. Confirm whether "master" means master data administration or a consolidated operations dashboard when implementing it.

Each department dashboard should expose pending work and responsibilities. Executive reporting should present conclusions and allow drill-down into supporting records, history and documents. Establish departmental KPI definitions with the owner before implementation.

## Financial traceability

Preserve original accepted quotation values, original after-tax discount, proportional allocation to eligible 18% items, unchanged solar amounts, adjusted before-tax selling values, tax reductions, rounding adjustments and final IPO payable amount. These records must support future reporting and reconciliation. Do not alter historical quotations or BOQ costs to apply the discount.
