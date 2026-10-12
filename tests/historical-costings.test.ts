import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Decimal } from "decimal.js";
import { testDatabase } from "./database.js";
import { MastersRepository } from "../server/masters/repository.js";
import { calculate, type Masters } from "../server/boq/engine.js";
import { surveySchema } from "../server/boq/schema.js";
const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/historical-costings.json", import.meta.url),
    "utf8",
  ),
);
let db: Awaited<ReturnType<typeof testDatabase>>, masters: Masters;
before(async () => {
  db = await testDatabase();
  masters = await new MastersRepository(db.pool).list();
  // Exercise the workbook-era rules independently from future approved profiles.
  masters.engineeringProfiles=[];
  masters.rules.find(r=>r.key==="engineering-20")!.value="2";
});
after(async () => {
  await db?.close();
});
for (const historical of fixture.cases)
  test(`locked workbook costing ${historical.number}`, () => {
    const brand = (category: string, saved: string | undefined) => {
      const match = masters.brands.find(
        (b) =>
          b.category === category && b.name === (saved ?? "Any of the Above"),
      );
      assert.ok(match, `Reference brand ${category}: ${saved}`);
      return match.id;
    };
    const saved = historical.historicalBrands;
    const survey = surveySchema.parse({
      ...historical.survey,
      brands: {
        solar: brand("Solar Panel", saved["Solar Panel Brand"]),
        inverter: brand("Inverter", saved["Inverter Brand"] ?? "Chint Power"),
        battery: brand(
          "Battery & BMS",
          saved["Battery & BMS Brand"] ?? "Chint Power",
        ),
        cable: brand("Cable", saved["Cable Brand"]),
        switchgear: brand("Switchgear", saved["Switchgear Brand"] ?? "CHINT"),
      },
    });
    const result = calculate(survey, masters);
    assert.ok(
      new Decimal(result.total).eq(historical.summary["TOTAL PROJECT COST"]),
      historical.number,
    );
    for (const row of result.summary)
      assert.ok(
        new Decimal(row.cost).eq(historical.summary[row.name]),
        row.name,
      );
    for (const row of result.epc)
      assert.ok(new Decimal(row.cost).eq(historical.epc[row.name]), row.name);
    for (const line of result.lines)
      assert.ok(
        historical.lines.some(
          (expected: { key: string }) => expected.key === line.key,
        ),
        `Unexpected line ${line.key}`,
      );
    for (const expected of historical.lines) {
      const line = result.lines.find((l) => l.key === expected.key);
      if (!line) {
        // The current engine omits unused options; the workbook retained zero rows.
        assert.ok(
          new Decimal(expected.qty).isZero() &&
            new Decimal(expected.amount).isZero(),
          `Missing nonzero line ${expected.key}`,
        );
        continue;
      }
      assert.ok(
        new Decimal(line.qty).eq(expected.qty),
        `${expected.key} quantity`,
      );
      assert.ok(
        new Decimal(line.rate).eq(expected.rate),
        `${expected.key} rate`,
      );
      assert.ok(
        new Decimal(line.total).eq(expected.amount),
        `${expected.key} amount`,
      );
    }
  });
