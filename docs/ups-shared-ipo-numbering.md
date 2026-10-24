# Shared UPS IPO numbers

Approved 24 October 2026: Direct PO UPS sites may use the same IPO number for different order units in the same customer batch (for example, CHP-500 / 1/60 and CHP-500 / 2/60). The printed IPO number remains CHP-500. Each site retains its own immutable IPO ID, order number, accounts handoff and operational job.

The same unit cannot be issued twice, even if two requests arrive together. The batch total must remain consistent. An existing IPO with no recorded order number cannot be silently reused; its identity needs review. Other customers and ordinary quotation/solar routes cannot reuse a UPS batch number.

All four checks use the same rule: Direct PO preparation, saved evidence details, sale preview, and final issuance. The database separately guards duplicate IPO/order units. The original reference registry root remains unchanged; additional UPS documents have immutable reference aliases pointing to that root. Automatic references resolve an alias before allocating a new number.

Migration 102 changes numbering constraints and adds the alias table. It does not rewrite issued snapshots, masters, prices, quantities, warehouse movements or balances. The upgrade regression runs preservation checks against an existing issued UPS document and repeats migration safely.
