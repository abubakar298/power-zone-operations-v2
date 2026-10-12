# Full Breakup: individual selling amount for every customer row

Owner clarification, 10 October 2026: Full Breakup must show a selling amount for every displayed row, rather than merged cable/accessory amount cells. Protection boxes each remain a consolidated customer scope row. Basic Breakup and No Breakup remain grouped.

New Solar Hybrid and BESS Only Full Breakup snapshots store selling-only amounts on their customer scope items. AC inverter/load-panel quantities split the frozen cable total, with each partition priced by its exact quantity share. DC red/black, accessories, smart meter and genset each use their underlying approved selling prices. Source component costing remains protected and unchanged.

The parent canonical financial rows remain intact for existing revision, tax, management review and IPO/PT logic. Individual displayed amounts reconcile exactly to those rows; deterministic cent rounding carries any residual to the final item. The PDF-only management-approved discount offer increase follows saved per-item allowances in integer cents. No change to net payable, standard pricing policy, tax, special discount authority or financial allocation.

Historical snapshots without individual item amounts retain their saved merged display. No history/master rewrite or migration. Direct Product and C&I pricing are unchanged.

Verification: 29 focused commercial/BESS/customer-scope/legacy-display tests passed, plus BESS Only rerun with explicit per-display-row assertions. Server TypeScript compilation passed. Full Breakup single-page PDF visually reviewed: every displayed row has a right-aligned independent amount; total matches previous layout. No full backend/browser/security suite run.
