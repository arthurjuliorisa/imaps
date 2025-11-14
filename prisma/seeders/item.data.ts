import { ItemType } from '@prisma/client';

interface ItemData {
  code: string;
  name: string;
  type: ItemType;
  uomCode: string; // Will be resolved to uomId in seeder
}

export const rawMaterialData: ItemData[] = [
  { code: 'RM-001', name: 'Steel Sheet Cold Rolled 0.8mm', type: ItemType.RM, uomCode: 'SHEET' },
  { code: 'RM-002', name: 'Aluminum Plate 5mm', type: ItemType.RM, uomCode: 'SHEET' },
  { code: 'RM-003', name: 'ABS Plastic Pellets Natural', type: ItemType.RM, uomCode: 'KG' },
  { code: 'RM-004', name: 'Polycarbonate Granules Transparent', type: ItemType.RM, uomCode: 'KG' },
  { code: 'RM-005', name: 'Copper Wire 1.5mm Diameter', type: ItemType.RM, uomCode: 'M' },
  { code: 'RM-006', name: 'PCB Board FR-4 Double Layer', type: ItemType.RM, uomCode: 'PCS' },
  { code: 'RM-007', name: 'LCD Display 7 inch TFT', type: ItemType.RM, uomCode: 'PCS' },
  { code: 'RM-008', name: 'Lithium Battery Cell 18650', type: ItemType.RM, uomCode: 'PCS' },
  { code: 'RM-009', name: 'Resistor Set 100pcs Various', type: ItemType.RM, uomCode: 'SET' },
  { code: 'RM-010', name: 'Capacitor Electrolytic 1000uF', type: ItemType.RM, uomCode: 'PCS' },
  { code: 'RM-011', name: 'Microcontroller ARM STM32', type: ItemType.RM, uomCode: 'PCS' },
  { code: 'RM-012', name: 'Stainless Steel Screw M4', type: ItemType.RM, uomCode: 'PCS' },
  { code: 'RM-013', name: 'Silicone Adhesive Tube 300ml', type: ItemType.RM, uomCode: 'UNIT' },
  { code: 'RM-014', name: 'Packaging Foam Roll 2mm', type: ItemType.RM, uomCode: 'ROLL' },
  { code: 'RM-015', name: 'Cardboard Box Medium Size', type: ItemType.RM, uomCode: 'PCS' },
];

export const finishedGoodsData: ItemData[] = [
  { code: 'FG-001', name: 'Smartphone Model X1 Pro 128GB', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-002', name: 'Laptop 14inch Core i5 8GB RAM', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-003', name: 'Smart TV LED 43 inch 4K', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-004', name: 'Wireless Router Dual Band AC1200', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-005', name: 'Bluetooth Speaker Portable 20W', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-006', name: 'Power Bank 20000mAh Fast Charge', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-007', name: 'Smartwatch GPS Fitness Tracker', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-008', name: 'Wireless Earbuds True Wireless', type: ItemType.FG, uomCode: 'SET' },
  { code: 'FG-009', name: 'LED Monitor 24inch Full HD', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-010', name: 'Mechanical Keyboard RGB Gaming', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-011', name: 'Wireless Mouse Ergonomic Design', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-012', name: 'USB Hub 7 Port Powered', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-013', name: 'External SSD 1TB USB 3.2', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-014', name: 'Webcam Full HD 1080p 60fps', type: ItemType.FG, uomCode: 'UNIT' },
  { code: 'FG-015', name: 'Gaming Headset Surround Sound', type: ItemType.FG, uomCode: 'UNIT' },
];

export const semiFinishedData: ItemData[] = [
  { code: 'SFG-001', name: 'Assembled PCB Main Board (unprogrammed)', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-002', name: 'Metal Chassis Stamped (unpainted)', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-003', name: 'Plastic Housing Molded (unfinished)', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-004', name: 'LCD Assembly with Touch Panel', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-005', name: 'Battery Pack Assembled (untested)', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-006', name: 'Speaker Module Assembled', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-007', name: 'Camera Module with Lens', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-008', name: 'Charging Port Assembly', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-009', name: 'Antenna Component Assembled', type: ItemType.SFG, uomCode: 'PCS' },
  { code: 'SFG-010', name: 'Button Panel Pre-assembled', type: ItemType.SFG, uomCode: 'SET' },
];

export const capitalGoodsData: ItemData[] = [
  { code: 'CAP-001', name: 'SMT Pick and Place Machine', type: ItemType.CAPITAL, uomCode: 'UNIT' },
  { code: 'CAP-002', name: 'Reflow Oven 8 Zone', type: ItemType.CAPITAL, uomCode: 'UNIT' },
  { code: 'CAP-003', name: 'Injection Molding Machine 150T', type: ItemType.CAPITAL, uomCode: 'UNIT' },
  { code: 'CAP-004', name: 'CNC Machining Center 3-Axis', type: ItemType.CAPITAL, uomCode: 'UNIT' },
  { code: 'CAP-005', name: 'Industrial Conveyor Belt System', type: ItemType.CAPITAL, uomCode: 'SET' },
  { code: 'CAP-006', name: 'Automated Testing Equipment', type: ItemType.CAPITAL, uomCode: 'UNIT' },
  { code: 'CAP-007', name: 'Laser Marking Machine', type: ItemType.CAPITAL, uomCode: 'UNIT' },
];

export const scrapItemsData: ItemData[] = [
  { code: 'SCR-001', name: 'Defective PCB Board', type: ItemType.SCRAP, uomCode: 'PCS' },
  { code: 'SCR-002', name: 'Damaged LCD Screen', type: ItemType.SCRAP, uomCode: 'PCS' },
  { code: 'SCR-003', name: 'Rejected Plastic Housing', type: ItemType.SCRAP, uomCode: 'PCS' },
  { code: 'SCR-004', name: 'Metal Scraps Mixed', type: ItemType.SCRAP, uomCode: 'KG' },
  { code: 'SCR-005', name: 'Electronic Component Waste', type: ItemType.SCRAP, uomCode: 'KG' },
  { code: 'SCR-006', name: 'Packaging Material Waste', type: ItemType.SCRAP, uomCode: 'KG' },
  { code: 'SCR-007', name: 'Failed Battery Pack', type: ItemType.SCRAP, uomCode: 'PCS' },
  { code: 'SCR-008', name: 'Copper Wire Scraps', type: ItemType.SCRAP, uomCode: 'KG' },
  { code: 'SCR-009', name: 'Defective Camera Module', type: ItemType.SCRAP, uomCode: 'PCS' },
  { code: 'SCR-010', name: 'Broken Glass Panel', type: ItemType.SCRAP, uomCode: 'KG' },
];
