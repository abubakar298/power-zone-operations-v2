-- Store newly agreed software costing separately from original commercial evidence.
CREATE TABLE ubl_history_cost_baselines (
 configuration_id text NOT NULL REFERENCES ubl_configurations(id),
 stage text NOT NULL,
 total_cost numeric NOT NULL CHECK(total_cost>0),
 panel_rate numeric NOT NULL,
 basis text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(configuration_id,stage)
);
INSERT INTO ubl_history_cost_baselines(configuration_id,stage,total_cost,panel_rate,basis) VALUES
('20-20-30','Proposed',3774243,30,'Owner agreed software baseline: current non-panel rates, 63A 4P changeover 7500 under review, panels 30/W; not reconstructed historical purchasing cost.'),
('20-20-30','Negotiated',3774243,30,'Owner agreed software baseline: current non-panel rates, 63A 4P changeover 7500 under review, panels 30/W; not reconstructed historical purchasing cost.'),
('20-20-30','Revised',3954243,39,'Owner agreed current software baseline: panels 39/W, 63A 4P changeover 7500 under review, installation includes delivery.');
