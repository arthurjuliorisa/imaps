import React from 'react';
import { CustomsReportTemplate } from '@/app/components/customs/CustomsReportTemplate';
import { MutationData } from '@/app/components/customs/MutationReportTable';

const sampleData: MutationData[] = [
  {
    id: 1,
    itemCode: 'STL-001',
    itemName: 'Steel Plate',
    unit: 'KG',
    beginning: 1000,
    in: 500,
    out: 200,
    adjustment: 0,
    ending: 1300,
    stockOpname: 1300,
    variant: 0,
    remarks: 'From PT. Supplier ABC',
  },
  {
    id: 2,
    itemCode: 'ALU-002',
    itemName: 'Aluminum Sheet',
    unit: 'KG',
    beginning: 800,
    in: 300,
    out: 150,
    adjustment: 0,
    ending: 950,
    stockOpname: 950,
    variant: 0,
    remarks: 'Regular stock',
  },
];

export default function IncomingGoodsReportPage() {
  return (
    <CustomsReportTemplate
      title="Laporan Pemasukan Barang"
      subtitle="Report of Incoming Goods - Bonded Zone"
      sampleData={sampleData}
    />
  );
}
