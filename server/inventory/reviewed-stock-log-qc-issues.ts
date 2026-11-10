// QC issue references from the current Chint Stock Main Log, checked against
// each site's delivery note. These rows never import or replay warehouse stock.
type Item = readonly [itemId: string, description: string, quantity: string, unit?: string];
type Review = {
  ipo: string;
  document: string;
  firstRow: number;
  items: readonly Item[];
  review?: string;
};

const inverter=['CH-PCS-HYB-1P-006','6 kW hybrid inverter','1'] as const;
const bms=['CH-BMS-LV','Low-voltage BMS','1'] as const;
const battery=(quantity:string):Item=>['CH-BAT-LV-05 KW','5 kWh low-voltage battery',quantity];
const vpd=['CH-VPD-63A/2P','Voltage protection device','1'] as const;
const box=['CH-5WAY-DB','5-way distribution box','1'] as const;

// Source: Chint Stock → Main Log (tab gid=0), original workbook
// 15HBB6wJYJ78-2P3VkRT8F-aAGgVVDCKKIt4MmdlHNvs. Row numbers refer to the
// 10 November 2026 read; the exact DO number and row order identify each line.
const reviews = new Map<string, Review>([
  ['registered-UBL:UPS:185/250',{
    ipo:'CHP-163(185/250)',document:'CPZ-DO-809',firstRow:1421,
    items:[inverter,battery('2'),bms,vpd,box],
  }],
  ['registered-MBL:CHP-338:60-site order:15/60',{
    ipo:'CHP-338(15/60)',document:'CPZ-DO-812',firstRow:1428,
    items:[inverter,battery('1'),bms,vpd,box],
    review:'CPZ-DO-812 also lists one 60×60 duct, 10 ft of flexible pipe and one tape roll. Confirm their source before verifying usage.',
  }],
  ['registered-UBL:UPS:183/250',{
    ipo:'CHP-163(183/250)',document:'CPZ-DO-814',firstRow:1438,
    items:[inverter,battery('2'),bms,vpd,box],
  }],
  ['registered-UBL:SOLAR:347',{
    ipo:'CHP-347',document:'CPZ-DO-833',firstRow:1461,
    items:[['CH-Solar Plate C620','620 W solar panel','33']],
    review:'CPZ-DO-833 is partial. The signed copy also records one structure, which is absent from this stock log. Confirm its source and remaining deliveries before verifying usage.',
  }],
  ['registered-UBL:UPS:165/250',{
    ipo:'CHP-163(165/250)',document:'CPZ-DO-841',firstRow:1487,
    items:[inverter,battery('2'),bms,box,vpd],
  }],
  ['live-ipo:d24a86bd-7bc8-456c-8ac2-28b4d042bac8',{
    ipo:'CHP-338(24/60)',document:'CPZ-DO-842',firstRow:1492,
    items:[inverter,battery('1'),bms,box,vpd],
    review:'CPZ-DO-842 also lists one 60×60 duct and 10 ft of flexible pipe. Confirm their source before verifying usage.',
  }],
]);

export function reviewedStockLogQcIssue(boardId:string){
  return reviews.get(boardId);
}
