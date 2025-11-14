import { daysAgo } from './helpers';

export function getRawMaterialMutationData() {
  return [
    {
      date: daysAgo(30),
      itemCode: 'RM-006',
      uomCode: 'PCS',
      beginning: 1000,
      incoming: 5000,
      outgoing: 3500,
      adjustment: 0,
      ending: 2500,
      stockOpname: 2500,
      variant: 0,
      remarks: 'Monthly stock movement',
    },
    {
      date: daysAgo(30),
      itemCode: 'RM-003',
      uomCode: 'KG',
      beginning: 5000,
      incoming: 15000,
      outgoing: 12000,
      adjustment: 0,
      ending: 8000,
      stockOpname: 8000,
      variant: 0,
      remarks: 'Monthly stock movement',
    },
    {
      date: daysAgo(30),
      itemCode: 'RM-008',
      uomCode: 'PCS',
      beginning: 2000,
      incoming: 10000,
      outgoing: 8500,
      adjustment: -50,
      ending: 3450,
      stockOpname: 3450,
      variant: 0,
      remarks: 'Minor adjustment for damaged items',
    },
  ];
}

export function getProductionMutationData() {
  return [
    {
      date: daysAgo(25),
      itemCode: 'FG-001',
      uomCode: 'UNIT',
      beginning: 200,
      incoming: 800,
      outgoing: 500,
      adjustment: 0,
      ending: 500,
      stockOpname: 500,
      variant: 0,
      remarks: 'Regular production cycle',
    },
    {
      date: daysAgo(25),
      itemCode: 'FG-002',
      uomCode: 'UNIT',
      beginning: 150,
      incoming: 500,
      outgoing: 300,
      adjustment: 0,
      ending: 350,
      stockOpname: 350,
      variant: 0,
      remarks: 'Regular production cycle',
    },
    {
      date: daysAgo(25),
      itemCode: 'FG-005',
      uomCode: 'UNIT',
      beginning: 500,
      incoming: 2000,
      outgoing: 1000,
      adjustment: -10,
      ending: 1490,
      stockOpname: 1490,
      variant: 0,
      remarks: 'Small adjustment for QC fails',
    },
  ];
}

export function getWIPData() {
  return [
    {
      date: daysAgo(20),
      itemCode: 'SFG-001',
      uomCode: 'PCS',
      quantity: 1500,
      remarks: 'PCB boards in assembly queue',
    },
    {
      date: daysAgo(15),
      itemCode: 'SFG-004',
      uomCode: 'PCS',
      quantity: 800,
      remarks: 'LCD assemblies awaiting final testing',
    },
    {
      date: daysAgo(10),
      itemCode: 'SFG-005',
      uomCode: 'PCS',
      quantity: 1200,
      remarks: 'Battery packs in testing phase',
    },
    {
      date: daysAgo(5),
      itemCode: 'SFG-002',
      uomCode: 'PCS',
      quantity: 600,
      remarks: 'Metal chassis awaiting painting',
    },
  ];
}

export function getScrapMutationData() {
  return [
    {
      date: daysAgo(20),
      scrapCode: 'SCRAP-2024-001',
      uomCode: 'KG',
      beginning: 0,
      incoming: 50.5,
      outgoing: 0,
      adjustment: 0,
      ending: 50.5,
      stockOpname: 50.5,
      variant: 0,
      remarks: 'Electronic waste accumulation',
    },
    {
      date: daysAgo(20),
      scrapCode: 'SCRAP-2024-003',
      uomCode: 'KG',
      beginning: 100,
      incoming: 245.8,
      outgoing: 200,
      adjustment: 0,
      ending: 145.8,
      stockOpname: 145.8,
      variant: 0,
      remarks: 'Metal scrap disposal cycle',
    },
  ];
}

export function getCapitalGoodsMutationData() {
  return [
    {
      date: daysAgo(60),
      itemCode: 'CAP-001',
      uomCode: 'UNIT',
      beginning: 0,
      incoming: 2,
      outgoing: 0,
      adjustment: 0,
      ending: 2,
      stockOpname: 2,
      variant: 0,
      remarks: 'New equipment acquisition',
    },
    {
      date: daysAgo(60),
      itemCode: 'CAP-003',
      uomCode: 'UNIT',
      beginning: 1,
      incoming: 1,
      outgoing: 0,
      adjustment: 0,
      ending: 2,
      stockOpname: 2,
      variant: 0,
      remarks: 'Additional molding machine',
    },
  ];
}
