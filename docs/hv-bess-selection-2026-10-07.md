# HV BESS selection — 7 October 2026

Design selects the HV BESS ID and the coordinator can change it before costing/review. The selector derives inverter configuration, battery capacity, modules and BMS. API validation rejects unknown IDs and mismatching derived values. Existing drafts map matching legacy inverter/capacity pairs to IDs; unmatched legacy drafts require a selection before calculation. Partial drafts may still be saved without a selection.

42 configurations: single 10/12/15/20 kW with 10/15/20/30/40/60 kWh, and dual 2×12/2×15/2×20 kW with 20/30/40/60/80/120 kWh. LV and on-grid remain deferred.

BMS is calculated separately for each inverter: inverter quantity × ceiling(total module quantity / inverter quantity / maximum modules per BMS). Current limits are 5 kWh per module, 4 modules per BMS and 60 kWh per inverter. Dual 60/80/120 kWh therefore uses 4/4/6 BMS. Unequal module splits are rejected.

The 2×12 kW configuration uses existing dual switchgear rules: four 63A 4P MCBs, two 100A 4P MCCBs, one 100A rotary changeover and one AC SPD. Quick BOQ uses 15 m 16 mm² 4-core and 20 m 25 mm² 4-core. Survey quantities remain measured inputs. DC protection remains string-based.

Supplied HV landed costs already match reference values and exclude GST. Migration appends a rate version only if the current value/status differs; adds 2×12 kW configuration. Saved BOQ/quotation snapshots remain unchanged. New calculated snapshots record BMS rule version.

Revision feedback no longer depends on discount metrics when the discount is unchanged. Revision confirmations use an in-app modal with cancel and Escape support rather than a browser-native confirmation. Cancellation preserves remarks and sends no request.
