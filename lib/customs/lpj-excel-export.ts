import ExcelJS from 'exceljs';

export type LpjExcelColumnType = 'text' | 'number' | 'date';

export interface LpjExcelColumn {
  key: string;
  label: string;
  type?: LpjExcelColumnType;
  width?: number;
}

export const LPJ_MUTATION_COLUMNS: LpjExcelColumn[] = [
  { key: 'no', label: 'No', type: 'number', width: 6 },
  { key: 'companyName', label: 'Company Name', type: 'text', width: 24 },
  { key: 'itemCode', label: 'Kode Barang', type: 'text', width: 18 },
  { key: 'itemName', label: 'Nama Barang', type: 'text', width: 32 },
  { key: 'itemType', label: 'Item Type', type: 'text', width: 14 },
  { key: 'unit', label: 'Satuan Barang', type: 'text', width: 16 },
  { key: 'beginning', label: 'Saldo Awal', type: 'number', width: 16 },
  { key: 'in', label: 'Jumlah Pemasukan Barang', type: 'number', width: 24 },
  { key: 'out', label: 'Jumlah Pengeluaran Barang', type: 'number', width: 26 },
  { key: 'adjustment', label: 'Penyesuaian', type: 'number', width: 16 },
  { key: 'ending', label: 'Saldo Akhir', type: 'number', width: 16 },
  { key: 'stockOpname', label: 'Hasil Pencacahan', type: 'number', width: 18 },
  { key: 'variant', label: 'Jumlah Selisih', type: 'number', width: 16 },
  { key: 'remarks', label: 'Keterangan', type: 'text', width: 28 },
];

export const LPJ_WIP_COLUMNS: LpjExcelColumn[] = [
  { key: 'no', label: 'No', type: 'number', width: 6 },
  { key: 'companyName', label: 'Company Name', type: 'text', width: 24 },
  { key: 'itemCode', label: 'Kode Barang', type: 'text', width: 18 },
  { key: 'itemName', label: 'Nama Barang', type: 'text', width: 32 },
  { key: 'itemType', label: 'Item Type', type: 'text', width: 14 },
  { key: 'unitQuantity', label: 'Satuan Barang', type: 'text', width: 16 },
  { key: 'quantity', label: 'jumlah', type: 'number', width: 16 },
  { key: 'stockDate', label: 'Stock Date', type: 'date', width: 16 },
  { key: 'remarks', label: 'catatan', type: 'text', width: 28 },
  { key: 'createdAt', label: 'Created At', type: 'date', width: 16 },
];

function toExcelDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toExcelNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeCellValue(value: unknown, type: LpjExcelColumnType | undefined): string | number | Date | null {
  if (type === 'date') return toExcelDate(value);
  if (type === 'number') return toExcelNumber(value);
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export async function generateLpjExcelBuffer(params: {
  rows: Record<string, unknown>[];
  columns: LpjExcelColumn[];
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
