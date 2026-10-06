# Coordination stages and turnaround

The dashboard derives work buckets from persisted survey, costing, pricing, quotation, IPO and Operations records. Clicking a stage filters its documents; Open workflow selects the specific source document where supported. Management decisions remain restricted to Admin/Management.

Quotation review and sale receipt use append-only coordination events. Submit, management approve/request revision and PO/approval receipt have server timestamps. Requested changes require a new quotation revision; historical quotations remain immutable. Receipt tracking does not replace evidence submission or IPO approval. Existing sample quotations are not retroactively given approval/receipt timestamps.

Owner targets: survey receipt to prepared saved quotation 15 minutes excluding recorded costing-review waiting; management quotation submission to decision 20 minutes; recorded PO receipt to IPO submission 15 minutes; saved IPO to Operations handoff 30 minutes. Aging is displayed in minutes/hours/days. The system tracks continuous elapsed time, not inferred keyboard activity or working hours. Target performance denominators contain only recorded completed transitions. Activity counts use the last 30 days; turnaround ratios currently use all recorded measurable completions. Customer waiting and management waiting are distinct responsibilities.

A sample under Atif Hameed's Coordinator login uses Demo Sites and is named SAMPLE – Atif Dashboard Training. It is a survey draft for practicing bucket progression, not a real sale.
