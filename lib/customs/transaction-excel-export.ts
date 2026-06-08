import ExcelJS from 'exceljs';

export type TransactionExcelColumnType = 'text' | 'number' | 'date';

export interface TransactionExcelColumn {
  key: string;
  label: string;
  type?: TransactionExcelColumnType;
  width?: number;
}

export const INCOMING_TRANSACTION_COLUMNS: TransactionExcelColumn[] = [
  { key: 'no', label: 'No', type: 'number', width: 6 },
  { key: 'companyName', label: 'Company', type: 'text', width: 24 },
  { key: 'documentType', label: 'Jenis Dokumen Pabean', type: 'text', width: 20 },
  { key: 'registrationNumber', label: 'Nomor Daftar', type: 'text', width: 18 },
  { key: 'registrationDate', label: 'Tanggal Daftar', type: 'date', width: 16 },
  { key: 'evidenceNumber', label: 'Nomor Bukti Penerimaan Barang', type: 'text', width: 28 },
  { key: 'internalDocument', label: 'Internal Document', type: 'text', width: 24 },
  { key: 'wmsId', label: 'WMS ID', type: 'text', width: 20 },
  { key: 'transactionDate', label: 'Tanggal Penerimaan Barang', type: 'date', width: 20 },
  { key: 'partyName', label: 'Nama Pengirim Barang', type: 'text', width: 28 },
  { key: 'itemType', label: 'Item Type', type: 'text', width: 14 },
  { key: 'itemTypeName', label: 'Nama Item Type', type: 'text', width: 20 },
  { key: 'itemCode', label: 'Kode Barang', type: 'text', width: 18 },
  { key: 'itemName', label: 'Nama Barang', type: 'text', width: 32 },
  { key: 'uom', label: 'UOM', type: 'text', width: 12 },
  { key: 'quantity', label: 'Quantity', type: 'number', width: 16 },
  { key: 'currency', label: 'Currency', type: 'text', width: 12 },
  { key: 'amount', label: 'Amount', type: 'number', width: 18 },
];

export const OUTGOING_TRANSACTION_COLUMNS: TransactionExcelColumn[] = [
  { key: 'no', label: 'No', type: 'number', width: 6 },
  { key: 'companyName', label: 'Company', type: 'text', width: 24 },
  { key: 'documentType', label: 'Jenis Dokumen Pabean', type: 'text', width: 20 },
  { key: 'registrationNumber', label: 'Nomor Daftar', type: 'text', width: 18 },
  { key: 'registrationDate', label: 'Tanggal Daftar', type: 'date', width: 16 },
  { key: 'evidenceNumber', label: 'Nomor Bukti Pengeluaran Barang', type: 'text', width: 28 },
  { key: 'wmsId', label: 'WMS ID', type: 'text', width: 20 },
  { key: 'transactionDate', label: 'Tanggal Pengeluaran Barang', type: 'date', width: 20 },
  { key: 'partyName', label: 'Nama Penerima Barang', type: 'text', width: 28 },
  { key: 'itemType', label: 'Item Type', type: 'text', width: 14 },
  { key: 'itemTypeName', label: 'Nama Item Type', type: 'text', width: 20 },
  { key: 'itemCode', label: 'Kode Barang', type: 'text', width: 18 },
  { key: 'itemName', label: 'Nama Barang', type: 'text', width: 32 },
  { key: 'uom', label: 'UOM', type: 'text', width: 12 },
  { key: 'quantity', label: 'Quantity', type: 'number', width: 16 },
  { key: 'currency', label: 'Currency', type: 'text', width: 12 },
  { key: 'amount', label: 'Amount', type: 'number', width: 18 },
];

export const INTERNAL_TRANSACTION_COLUMNS: TransactionExcelColumn[] = [
  { key: 'no', label: 'No', type: 'number', width: 6 },
  { key: 'companyName', label: 'Company', type: 'text', width: 24 },
  { key: 'sourceType', label: 'Source Type', type: 'text', width: 14 },
  { key: 'wmsId', label: 'WMS ID', type: 'text', width: 20 },
  { key: 'internalEvidenceNumber', label: 'Internal Evidence Number', type: 'text', width: 28 },
  { key: 'transactionDate', label: 'Transaction Date', type: 'date', width: 18 },
  { key: 'section', label: 'Section / Source', type: 'text', width: 24 },
  { key: 'itemType', label: 'Item Type', type: 'text', width: 14 },
  { key: 'itemTypeName', label: 'Nama Item Type', type: 'text', width: 20 },
  { key: 'itemCode', label: 'Kode Barang', type: 'text', width: 18 },
  { key: 'itemName', label: 'Nama Barang', type: 'text', width: 32 },
  { key: 'uom', label: 'UOM', type: 'text', width: 12 },
  { key: 'quantity', label: 'Quantity', type: 'number', width: 16 },
  { key: 'amount', label: 'Amount', type: 'number', width: 18 },
];

function toExcelDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toExcelNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeCellValue(
  value: unknown,
  type: TransactionExcelColumnType | undefined
): string | number | Date | null {
  if (type === 'date') return toExcelDate(value);
  if (type === 'number') return toExcelNumber(value);
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export async function generateTransactionExcelBuffer(params: {
  rows: Record<string, unknown>[];
  columns: TransactionExcelColumn[];
  sheetName: string;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'iMAPS';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(params.sheetName.slice(0, 31));
  worksheet.columns = params.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: column.width ?? 15,
  }));

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  params.rows.forEach((row) => {
    const rowData: Record<string, string | number | Date | null> = {};

    params.columns.forEach((column) => {
      rowData[column.key] = normalizeCellValue(row[column.key], column.type);
    });

    const dataRow = worksheet.addRow(rowData);

    params.columns.forEach((column, index) => {
      const cell = dataRow.getCell(index + 1);

      if (column.type === 'date' && cell.value instanceof Date) {
        cell.numFmt = 'mm/dd/yyyy';
      }

      if (column.type === 'number' && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.000';
      }
    });
  });

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function contentDispositionFilename(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}
