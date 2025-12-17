import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: '',
    itemCode: 'SCR-001',
    itemName: 'Metal Scrap Type A',
    unit: 'KG',
    beginning: 150,
    in: 80,
    out: 50,
    adjustment: 0,
    ending: 180,
    stockOpname: 180,
    variant: 0,
    remarks: 'Scrap from production line',
  },
  {
    id: '',
    itemCode: 'SCR-002',
    itemName: 'Plastic Scrap Type B',
    unit: 'KG',
    beginning: 100,
    in: 40,
    out: 30,
    adjustment: 0,
    ending: 110,
    stockOpname: 110,
    variant: 0,
    remarks: 'Recyclable materials',
  },
];

export default function ScrapReportPage() {
  return (
    <CustomsReportTemplate
      title="LPJ Mutasi Barang Scrap"
      subtitle="Scrap Material Mutation Report - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
