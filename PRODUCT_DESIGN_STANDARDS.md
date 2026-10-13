# Power Zone Product Design Standards

Version 1 — approved implementation milestone, 10 October 2026.

## Purpose and source of truth
Preserve the existing Power Zone identity: restrained purple actions, white cards, pale purple selected states, charcoal text, original logo and system typography. This is an incremental design system, not a replacement application or a business policy. Existing approved customer PDFs keep their own approved print templates. Do not recolor logos or redesign document templates through application CSS.

Implementation sources:
- `web/ui/design-tokens.css`: semantic colors, type, spacing, radius and sizing.
- `web/ui/product.css`: common layouts and control treatments.
- `web/ui/Button.tsx`, `StatusBadge.tsx`, `Field.tsx`, `FinancialValue.tsx`: reusable React controls.
- `web/main.tsx`: loads legacy styles first, then tokens and shared standards.
- `web/numbers.ts`: existing precise Decimal display formatting; reuse rather than introduce another formatter.
- `web/AGENTS.md`: frontend implementation requirements for future changes.

Legacy screens remain functional and migrate incrementally when edited. New screens must use these standards. Do not undertake broad screen rewrites merely to comply. Presentation tokens never belong in Rate Master or editable business data.

## Semantic colors
| Meaning | Token / treatment | Use |
|---|---|---|
| Primary action | `--pz-primary` #5547d0, white label | Principal save/submit/create action; accessible darker shade of existing #6658e8 purple |
| Secondary action | `--pz-secondary-bg/text` | Supporting actions such as opening workflows and downloads |
| Neutral/navigation | `--pz-text`, white surface, border | Back, Cancel, Edit, filters; existing charcoal sign-out retained |
| Success/completed | `--pz-success/bg` | Approve, completed/approved status, successful save feedback |
| Warning/attention | `--pz-warning/bg` | Return for revision, overdue requests, attention needed |
| Error/destructive | `--pz-danger/bg` | Delete, reject permanently, validation errors, failed operations |
| Pending/waiting | `--pz-pending/bg` | Awaiting approval/in progress; never imply success |
| Disabled | `--pz-disabled-bg/text` | Unavailable actions with native disabled state and an adjacent reason |
| Selected/active | `--pz-selected-bg/border` | Active navigation, selected buckets; pair with aria-current/aria-pressed |
| Focus | `--pz-focus` | Visible keyboard outline, never remove without replacement |

The same treatment means the same thing everywhere. Color alone is insufficient: show a meaningful label/status, and an icon where useful. A stage called Quotation approval is navigation, not the approval action; its bucket uses selected/neutral styling. Use success only for the action or actual completed status. Corporate logo colors are brand identity, not status indicators.

## Actions and buttons
Use `Button` with an explicit variant; default type is button to prevent accidental form submission. Set type=submit only for a form's intended submit action. Loading uses loading=true and a meaningful loadingLabel, native disabled and aria-busy; prevent duplicate submission. Disabled is distinct from loading.

| Action | Variant | Wording |
|---|---|---|
| Create / Save / Submit for Approval | primary | Concrete verb and destination, e.g. Send for approval |
| Approve | success | Approve quotation / Approve IPO |
| Return / Request Revision | warning | Request revision, with reason |
| Reject irreversibly / Delete | danger | Explicit object and consequence |
| Save Draft | secondary | Save draft; no implication of submission |
| Download / Open workflow | secondary | Name the document/action |
| Cancel / Back / Edit / Clear filter | neutral | Cancel, Back to workspace, Edit, All pending tasks |
| Archive recoverably | neutral | Archive; confirmation states recovery semantics |

Normally one dominant primary action per screen or section. Approval is a semantic success action, not a decorative purple alternative. Keep parallel actions the same minimum height, padding, font and radius. Group final decisions at the end of long review content. A sticky bar is optional only if it does not obscure content, focused controls or mobile keyboards; no automatic sticky conversion in this milestone. Actions must operate on the displayed saved version, not unsaved preview values.

## Typography, numbers and spacing
System font stack: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. No new web font dependency. Page h1 about29px desktop/26px mobile, section h2 about20px, subsection h3 about16px, body14px, controls/labels13px, captions12px. Maintain h1→h2→h3 semantic hierarchy without selecting heading level for appearance. Body line-height1.5, explanatory copy up to1.7. Labels use600 weight; headings retain restrained550–600 weights. Do not render essential information in tiny uppercase captions.

Spacing scale4/8/12/16/24/32px. Card padding24px desktop/16px mobile; section gap24px; form row/column gap24px. Control radius8px, card radius12px. Form controls and buttons at least44px high. Do not stretch an input to fill space caused by its neighboring helper text: reserve helper space beneath both fields using Field/pz-form-grid, and align labels/controls across each row. Let long labels wrap consistently.

Use existing Decimal formatting. Money: comma thousands separators and exactly2 decimals. Percentages: at most2 decimals. Quantities: integer where the unit requires whole items; otherwise at most2 decimals unless an approved engineering specification requires more. IDs/references are strings, never comma-formatted or stripped of leading zeroes. Monetary and quantity columns align right and use tabular numerals; labels/descriptions align left. Show units/currency in column headings. Do not use Number/parseFloat for financial arithmetic or change saved precision for display. Missing values are Not entered/Not available, not fabricated zero. Specifications such as6mm² remain descriptive text, not financial formatting.

## Layout patterns
- Department work buckets reuse the original stage-grid/stage-card visual: white cards in a three-column desktop grid, clear stage label, prominent record count and subtle action caption; pale purple hover/selected treatment and a two-column mobile grid. Design and Project Coordination use this shared pattern, and future department work must retain it rather than introduce plain panels or a different bucket style. The entire card is an accessible button that opens its real record bucket.
- Dashboard/workspace: existing1280px maximum content width, clear title, work buckets followed by pending list. No unrelated metrics on Coordinator work screen.
- Project details: header with customer/site/reference, status and version; clearly separated technical, commercial and history panels.
- Forms: pz-form-grid with two equal columns, one column at700px and below; max form width900px when practical. Required/optional fields explicitly identified. Helpers below controls; errors associated with controls.
- Document lists: toolbar search/filters, result count, sortable labels if supported, table in pz-table-scroll, explicit empty state. Do not disguise a unavailable feature as a working link.
- Review/approval: saved document preview and evidence, summary, then final decisions. Internal confidential panels remain role-authorized on the backend.
- Financial summaries: label left/value right, consistent precision, distinct subtotals/totals, clear tax presentation. Do not infer costs from public presentation.
- Tables:12px cell padding,13px text, concise headers, no clipped identifiers. Dense variants only for genuinely large internal data tables, preserving readable targets.
- Modals: existing native dialog/shared confirmation infrastructure, clear heading/consequence, Cancel and one explicit confirm action. Focus enters dialog, Escape cancels, focus returns to invoker. Default focus is the safe cancel action for consequential requests.
- Mobile: retain existing navigation toggle and breakpoints;700px shared form/action stacking,600px two-column bucket grid,1000px compact shell. No redesign of legacy module-specific650/680px rules. Permit horizontal table scrolling instead of compressing numbers or hiding columns silently. Do not encode breakpoint rules as editable business values.

## Interaction contracts
- Workspace navigation always opens the department's bucket overview, including when already in that workspace on a record, history or performance page. Clear transient detail/create navigation, retain saved records, and apply the existing unsaved-change guard before leaving a form. Use this contract across current and future department workspaces.
- Save: validation first; preserve input on error; success identifies saved record/version. Never claim saved before server success.
- Submit/approve: explain resulting stage, confirm consequential transitions through existing helpers, disable while pending. Cancellation performs no request or mutation. Server authorization remains authoritative.
- Revise: load original values, show requested changes, create a new immutable version; never overwrite approved snapshots. Labels distinguish draft and approved documents.
- Cancel/Back: return to originating workspace, preserve filters when possible; warn before discarding changed work. Reuse existing unsaved-change mechanisms; do not add duplicate dialogs. Native browser Back should not quietly discard committed work.
- Loading: specific message/skeleton, aria-busy on affected region, avoid blank screen; no fabricated progress percentages. Controls unrelated to the operation need not be blocked.
- Action errors: display the error immediately beside or beneath the button/control that initiated the action, using role=alert and an accessible description. Keep entered data intact. Page-top errors are reserved for initial page-load failures; do not use them as the only feedback for a failed save, attachment, submission or approval. Reuse action-scoped feedback for all new or modified screens.
- Success/error: shared semantic treatments, role=status for save feedback, role=alert for errors; clear actionable wording without credentials/internal error stacks. Move focus to validation summary for multi-field errors when needed. Do not reset the form after failure.
- Search: labeled control, specify searchable fields, debounce server requests when appropriate; retain term, show loading/result count/clear. No new record creation merely by typing.
- Filtering: immediate visible results, active selection reflected in controls, All pending tasks resets stage only; overdue checkbox remains independent. Empty result differs from no documents at all.
- Empty states: explain what is absent and next available action, never display a meaningless blank table.
- Disabled: show reason nearby or in accessible description; do not rely on hover-only tooltip. The backend must still enforce permissions.
- Keyboard: native buttons/inputs/select/summary/dialog; logical document order; visible focus; aria-current for navigation, aria-pressed for toggles. Do not replace buttons with clickable divs or trap focus outside a modal.
- Mobile: touch targets44px, wrapped action groups, no hover-only essential controls. Respect prefers-reduced-motion.

## Reuse and scope
Coordinator Workspace demonstrates shared Buttons (All pending tasks neutral, Open workflow secondary), StatusBadge (Overdue warning, In progress pending), semantic bucket selection, readable captions/table padding, tabular counts and responsive filtering. The original six workflow buckets remain available. An approved quotation awaiting-send bucket was added by explicit Management instruction on 11 October 2026; sending is recorded separately from approval.

Existing financial engine, customer data, rates, permissions, document history, PDF templates and approval requirements are out of scope. This milestone does not claim every historical screen meets every standard or certify all accessibility conditions. Apply standards to future/modified shared interfaces; refine remaining screens in explicitly authorized milestones.

## Focused verification checklist
Build/typecheck; ensure keyboard-visible focus and44px targets; check normal/selected/disabled/loading variants; verify text contrast for used semantic foreground/background pairs; verify Coordinator filters/actions/empty states at desktop/mobile; retain Management workflow and confidential-data controls. Do not rerun full business regressions for presentation-only changes unless unresolved evidence warrants it.

## Sidebar visual baseline — user instruction, 14 October 2026
Keep the established sidebar layout, colors and selected-state treatment across departments. Clicking a navigation item must not increase the label's font weight; labels remain normal weight. Document-count badges retain consistent styling in both states. Do not redesign sidebar visuals unless the user explicitly requests it. Functional actions/counts may be updated without changing this visual baseline.
