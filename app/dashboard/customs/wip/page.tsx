import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: 1,
    itemCode: 'WIP-001',
    itemName: 'Semi-Finished Product A',
    unit: 'PCS',
    beginning: 300,
    in: 150,
    out: 100,
    adjustment: 0,
    ending: 350,
    stockOpname: 350,
    variant: 0,
    remarks: 'Work in progress - Assembly line 1',
  },
  {
    id: 2,
    itemCode: 'WIP-002',
    itemName: 'Semi-Finished Product B',
    unit: 'PCS',
    beginning: 200,
    in: 100,
    out: 80,
    adjustment: 0,
    ending: 220,
    stockOpname: 220,
    variant: 0,
    remarks: 'Work in progress - Assembly line 2',
  },
];

export default function WIPReportPage() {
  return (
    <CustomsReportTemplate
      title="LPJ Work In Progress"
      subtitle="Work In Progress Mutation Report - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
