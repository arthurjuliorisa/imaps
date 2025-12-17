import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: '',
    itemCode: 'FIN-001',
    itemName: 'Finished Product A',
    unit: 'PCS',
    beginning: 500,
    in: 0,
    out: 150,
    adjustment: 0,
    ending: 350,
    stockOpname: 350,
    variant: 0,
    remarks: 'Export to Client XYZ',
  },
  {
    id: '',
    itemCode: 'FIN-002',
    itemName: 'Finished Product B',
    unit: 'PCS',
    beginning: 300,
    in: 0,
    out: 100,
    adjustment: 0,
    ending: 200,
    stockOpname: 200,
    variant: 0,
    remarks: 'Domestic delivery',
  },
];

export default function OutgoingGoodsReportPage() {
  return (
    <CustomsReportTemplate
      title="Laporan Pengeluaran Barang"
      subtitle="Report of Outgoing Goods - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
