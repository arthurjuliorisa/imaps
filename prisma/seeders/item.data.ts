interface ItemData {
  code: string;
  name: string;
  uomCode: string; // Will be resolved to uomId in seeder
}

export const rawMaterialData: ItemData[] = [
  { code: 'RM-001', name: 'Steel Sheet Cold Rolled 0.8mm', uomCode: 'SHEET' },
  { code: 'RM-002', name: 'Aluminum Plate 5mm', uomCode: 'SHEET' },
  { code: 'RM-003', name: 'ABS Plastic Pellets Natural', uomCode: 'KG' },
  { code: 'RM-004', name: 'Polycarbonate Granules Transparent', uomCode: 'KG' },
  { code: 'RM-005', name: 'Copper Wire 1.5mm Diameter', uomCode: 'M' },
  { code: 'RM-006', name: 'PCB Board FR-4 Double Layer', uomCode: 'PCS' },
  { code: 'RM-007', name: 'LCD Display 7 inch TFT', uomCode: 'PCS' },
  { code: 'RM-008', name: 'Lithium Battery Cell 18650', uomCode: 'PCS' },
  { code: 'RM-009', name: 'Resistor Set 100pcs Various', uomCode: 'SET' },
  { code: 'RM-010', name: 'Capacitor Electrolytic 1000uF', uomCode: 'PCS' },
  { code: 'RM-011', name: 'Microcontroller ARM STM32', uomCode: 'PCS' },
  { code: 'RM-012', name: 'Stainless Steel Screw M4', uomCode: 'PCS' },
  { code: 'RM-013', name: 'Silicone Adhesive Tube 300ml', uomCode: 'UNIT' },
  { code: 'RM-014', name: 'Packaging Foam Roll 2mm', uomCode: 'ROLL' },
  { code: 'RM-015', name: 'Cardboard Box Medium Size', uomCode: 'PCS' },
];

export const finishedGoodsData: ItemData[] = [
  { code: 'FG-001', name: 'Smartphone Model X1 Pro 128GB', uomCode: 'UNIT' },
  { code: 'FG-002', name: 'Laptop 14inch Core i5 8GB RAM', uomCode: 'UNIT' },
  { code: 'FG-003', name: 'Smart TV LED 43 inch 4K', uomCode: 'UNIT' },
  { code: 'FG-004', name: 'Wireless Router Dual Band AC1200', uomCode: 'UNIT' },
  { code: 'FG-005', name: 'Bluetooth Speaker Portable 20W', uomCode: 'UNIT' },
  { code: 'FG-006', name: 'Power Bank 20000mAh Fast Charge', uomCode: 'UNIT' },
  { code: 'FG-007', name: 'Smartwatch GPS Fitness Tracker', uomCode: 'UNIT' },
  { code: 'FG-008', name: 'Wireless Earbuds True Wireless', uomCode: 'SET' },
  { code: 'FG-009', name: 'LED Monitor 24inch Full HD', uomCode: 'UNIT' },
  { code: 'FG-010', name: 'Mechanical Keyboard RGB Gaming', uomCode: 'UNIT' },
  { code: 'FG-011', name: 'Wireless Mouse Ergonomic Design', uomCode: 'UNIT' },
  { code: 'FG-012', name: 'USB Hub 7 Port Powered', uomCode: 'UNIT' },
  { code: 'FG-013', name: 'External SSD 1TB USB 3.2', uomCode: 'UNIT' },
  { code: 'FG-014', name: 'Webcam Full HD 1080p 60fps', uomCode: 'UNIT' },
  { code: 'FG-015', name: 'Gaming Headset Surround Sound', uomCode: 'UNIT' },
];

export const semiFinishedData: ItemData[] = [
  { code: 'SFG-001', name: 'Assembled PCB Main Board (unprogrammed)', uomCode: 'PCS' },
  { code: 'SFG-002', name: 'Metal Chassis Stamped (unpainted)', uomCode: 'PCS' },
  { code: 'SFG-003', name: 'Plastic Housing Molded (unfinished)', uomCode: 'PCS' },
  { code: 'SFG-004', name: 'LCD Assembly with Touch Panel', uomCode: 'PCS' },
  { code: 'SFG-005', name: 'Battery Pack Assembled (untested)', uomCode: 'PCS' },
  { code: 'SFG-006', name: 'Speaker Module Assembled', uomCode: 'PCS' },
  { code: 'SFG-007', name: 'Camera Module with Lens', uomCode: 'PCS' },
  { code: 'SFG-008', name: 'Charging Port Assembly', uomCode: 'PCS' },
  { code: 'SFG-009', name: 'Antenna Component Assembled', uomCode: 'PCS' },
  { code: 'SFG-010', name: 'Button Panel Pre-assembled', uomCode: 'SET' },
];

export const capitalGoodsData: ItemData[] = [
  { code: 'CAP-001', name: 'SMT Pick and Place Machine', uomCode: 'UNIT' },
  { code: 'CAP-002', name: 'Reflow Oven 8 Zone', uomCode: 'UNIT' },
  { code: 'CAP-003', name: 'Injection Molding Machine 150T', uomCode: 'UNIT' },
  { code: 'CAP-004', name: 'CNC Machining Center 3-Axis', uomCode: 'UNIT' },
  { code: 'CAP-005', name: 'Industrial Conveyor Belt System', uomCode: 'SET' },
  { code: 'CAP-006', name: 'Automated Testing Equipment', uomCode: 'UNIT' },
  { code: 'CAP-007', name: 'Laser Marking Machine', uomCode: 'UNIT' },
];

export const scrapItemsData: ItemData[] = [
  { code: 'SCR-001', name: 'Defective PCB Board', uomCode: 'PCS' },
  { code: 'SCR-002', name: 'Damaged LCD Screen', uomCode: 'PCS' },
  { code: 'SCR-003', name: 'Rejected Plastic Housing', uomCode: 'PCS' },
  { code: 'SCR-004', name: 'Metal Scraps Mixed', uomCode: 'KG' },
  { code: 'SCR-005', name: 'Electronic Component Waste', uomCode: 'KG' },
  { code: 'SCR-006', name: 'Packaging Material Waste', uomCode: 'KG' },
  { code: 'SCR-007', name: 'Failed Battery Pack', uomCode: 'PCS' },
  { code: 'SCR-008', name: 'Copper Wire Scraps', uomCode: 'KG' },
  { code: 'SCR-009', name: 'Defective Camera Module', uomCode: 'PCS' },
  { code: 'SCR-010', name: 'Broken Glass Panel', uomCode: 'KG' },
];
