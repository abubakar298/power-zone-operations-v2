import { useState, useEffect } from "react";
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
  const b = findBess(id);
  return (
    <label>
      BESS configuration
      <select
        name="bessId"
        aria-label="BESS configuration"
        required
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          const next = findBess(e.target.value);
          if (next) onChange?.(next.inverter);
        }}
      >
        <option value="">Select HV BESS ID</option>
        {bessConfigurations.map((v) => (
          <option key={v.id} value={v.id}>
            {v.id} · {v.inverter} · {v.batteryKwh} kWh
          </option>
        ))}
      </select>
      <input type="hidden" name="inverter" value={b?.inverter ?? ""} />
      <input type="hidden" name="batteryKwh" value={b?.batteryKwh ?? ""} />
      {b && (
        <small>
          {b.inverterQty} × {b.inverterKw} kW inverter · {b.batteryModules} × 5
          kWh battery modules · {b.bmsQty} BMS · HV
        </small>
      )}
    </label>
  );
}
