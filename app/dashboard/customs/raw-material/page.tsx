import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: 1,
    itemCode: 'RM-001',
    itemName: 'Raw Material A',
    unit: 'KG',
    beginning: 2000,
    in: 800,
    out: 600,
    adjustment: 10,
    ending: 2210,
    stockOpname: 2210,
    variant: 0,
    remarks: 'Monthly inventory',
  },
  {
    id: 2,
    itemCode: 'RM-002',
    itemName: 'Supporting Material B',
    unit: 'KG',
    beginning: 1500,
    in: 500,
    out: 400,
    adjustment: -5,
    ending: 1595,
    stockOpname: 1595,
    variant: 0,
    remarks: 'Regular stock movement',
  },
];

export default function RawMaterialReportPage() {
  return (
    <CustomsReportTemplate
      title="LPJ Mutasi Bahan Baku/Bahan Penolong"
      subtitle="Raw Material & Supporting Material Mutation Report - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
