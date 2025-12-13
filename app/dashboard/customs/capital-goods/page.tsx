import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: 1,
    itemCode: 'CAP-001',
    itemName: 'Production Machinery A',
    unit: 'UNIT',
    beginning: 5,
    in: 1,
    out: 0,
    adjustment: 0,
    ending: 6,
    stockOpname: 6,
    variant: 0,
    remarks: 'Capital goods - New machinery',
  },
  {
    id: 2,
    itemCode: 'CAP-002',
    itemName: 'Industrial Equipment B',
    unit: 'UNIT',
    beginning: 3,
    in: 0,
    out: 0,
    adjustment: 0,
    ending: 3,
    stockOpname: 3,
    variant: 0,
    remarks: 'Capital goods - Existing equipment',
  },
];

export default function CapitalGoodsReportPage() {
  return (
    <CustomsReportTemplate
      title="LPJ Mutasi Barang Modal"
      subtitle="Capital Goods Mutation Report - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
