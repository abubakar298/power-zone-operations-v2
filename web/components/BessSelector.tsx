import { useState, useEffect } from "react";
import { singlePhaseConfigurations } from "../../server/boq/equipment.js";
import {
  bessConfigurations,
  legacyBess,
  findBess,
} from "../../server/boq/bess.js";
export function BessSelector({
  initial,
  onChange,
}: {
  initial: any;
  onChange?: (inverter: string) => void;
}) {
  const [id, setId] = useState(
    initial.bessId ??
      legacyBess(initial.inverter ?? "", Number(initial.batteryKwh)),
  );
  useEffect(() => {
    setId(
      initial.bessId ??
        legacyBess(initial.inverter ?? "", Number(initial.batteryKwh)),
    );
  }, [initial.bessId, initial.inverter, initial.batteryKwh]);
  const sp = singlePhaseConfigurations.find(option => option.id === id);
  const resolve = (value: string) => findBess(value) ?? (() => {
    const entry = singlePhaseConfigurations.find(option => option.id === value);
    return entry ? { ...entry, inverter: "6 kW SP" } : undefined;
  })();
  const b = resolve(id);
  return (
    <label>
      BESS ID
      <select
        name="bessId"
        aria-label="BESS configuration"
        required
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          const next = resolve(e.target.value);
          if (next) onChange?.(next.inverter);
        }}
      >
        <option value="">Select BESS ID</option>
        <optgroup label="Single phase · 6 kW LV">
          {singlePhaseConfigurations.map(v => <option key={v.id} value={v.id}>{v.id} · 6 kW SP · {v.batteryKwh} kWh</option>)}
        </optgroup>
        <optgroup label="Three phase · HV">
        {bessConfigurations.map((v) => (
          <option key={v.id} value={v.id}>
            {v.id.replace(/^BESS-/, "")} · {v.inverter} · {v.batteryKwh} kWh
          </option>
        ))}
        </optgroup>
      </select>
      <input type="hidden" name="inverter" value={b?.inverter ?? ""} />
      <input type="hidden" name="batteryKwh" value={b?.batteryKwh ?? ""} />
      {sp && <small role="status">Electrical verification pending. Commercial preparation is enabled; this is not an installation clearance.</small>}
      {b && (
        <small>
          {b.inverterQty} × {b.inverterKw} kW inverter · {b.batteryModules} × 5
          kWh battery modules · {b.bmsQty} BMS · {sp ? "LV · Single phase" : "HV"}
        </small>
      )}
    </label>
  );
}
