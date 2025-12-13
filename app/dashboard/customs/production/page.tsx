import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: 1,
    itemCode: 'FG-001',
    itemName: 'Finished Goods Product A',
    unit: 'PCS',
    beginning: 800,
    in: 400,
    out: 300,
    adjustment: 0,
    ending: 900,
    stockOpname: 900,
    variant: 0,
    remarks: 'Production output - Month 12',
  },
  {
    id: 2,
    itemCode: 'FG-002',
    itemName: 'Finished Goods Product B',
    unit: 'PCS',
    beginning: 600,
    in: 200,
    out: 250,
    adjustment: 0,
    ending: 550,
    stockOpname: 550,
    variant: 0,
    remarks: 'Production output - Month 12',
  },
];

export default function ProductionReportPage() {
  return (
    <CustomsReportTemplate
      title="LPJ Mutasi Hasil Produksi"
      subtitle="Finished Goods Mutation Report - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
