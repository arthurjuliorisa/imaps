/**
 * STREAMING EXPORT UTILITY - IMPLEMENTATION READY
 * File: lib/streaming-export.ts
 * 
 * Digunakan untuk export data besar dengan memory efficient
 * Mendukung hingga 1 juta records
 */

import ExcelJS from 'exceljs';

export interface StreamExportOptions {
  sheetName?: string;
  maxRows?: number;
  chunkSize?: number;
  headerStyle?: boolean;
}

export interface ColumnConfig {
  header: string;
  key: string;
  width?: number;
  format?: (value: any) => string;
}

/**
 * STREAMING EXCEL EXPORT
 * Processes data in chunks to minimize memory usage
 * 
 * @example
 * const buffer = await streamExcelExport(
 *   async (skip, take) => await fetchFromDB(skip, take),
 *   columns,
 *   'Export Name'
 * );
 */
export async function streamExcelExport(
  queryFn: (skip: number, take: number) => Promise<any[]>,
  columns: ColumnConfig[],
  fileName: string,
  options: StreamExportOptions = {}
): Promise<Buffer> {
  const {
    sheetName = 'Export',
    maxRows = 1000000,
    chunkSize = 5000,
    headerStyle = true,
  } = options;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  // Setup columns
  worksheet.columns = columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width || 15,
  }));

  // Style header row
  if (headerStyle) {
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' }, // Dark blue
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // Process data in chunks
  let skip = 0;
  let totalRows = 0;
  const startTime = Date.now();

  while (totalRows < maxRows) {
    const chunk = await queryFn(skip, Math.min(chunkSize, maxRows - totalRows));

    if (chunk.length === 0) break;

    // Add rows
    chunk.forEach(item => {
      const row: any = {};
      columns.forEach(col => {
        const value = item[col.key];
        row[col.key] = col.format ? col.format(value) : value;
      });
      worksheet.addRow(row);
    });

    totalRows += chunk.length;
    skip += chunkSize;

    // Log progress every 50K rows
    if (totalRows % 50000 === 0) {
      console.log(`[Export] Processed ${totalRows.toLocaleString()} rows`);
    }
  }

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  const elapsedTime = Date.now() - startTime;

  console.log(
    `[Export] Completed: ${totalRows.toLocaleString()} rows, ` +
    `${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB, ` +
    `${(elapsedTime / 1000).toFixed(1)}s`
  );

  return Buffer.from(buffer);
}

/**
 * SIMPLE EXCEL EXPORT (untuk data kecil < 50K rows)
 * Faster untuk small datasets
 */
export async function simpleExcelExport(
  data: any[],
  columns: ColumnConfig[],
  fileName: string,
  options: StreamExportOptions = {}
): Promise<Buffer> {
  const { sheetName = 'Export', headerStyle = true } = options;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  // Setup columns
  worksheet.columns = columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width || 15,
  }));

  // Style header
  if (headerStyle) {
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' },
    };
  }

  // Add data rows
  data.forEach(item => {
    const row: any = {};
    columns.forEach(col => {
      const value = item[col.key];
      row[col.key] = col.format ? col.format(value) : value;
    });
    worksheet.addRow(row);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * CSV EXPORT (untuk data sangat besar, lightweight)
 * Lebih cepat dan ringan dari Excel untuk 1M+ rows
 */
export async function streamCSVExport(
  queryFn: (skip: number, take: number) => Promise<any[]>,
  columns: ColumnConfig[],
  chunkSize: number = 10000
): Promise<string> {
  const lines: string[] = [];
  const headers = columns.map(col => col.header);
  
  // Add header
  lines.push(headers.map(h => `"${h}"`).join(','));

  // Process in chunks
  let skip = 0;
  let totalRows = 0;

  while (true) {
    const chunk = await queryFn(skip, chunkSize);
    if (chunk.length === 0) break;

    chunk.forEach(item => {
      const values = columns.map(col => {
        const value = item[col.key];
        const formatted = col.format ? col.format(value) : value;
        
        // Escape CSV values
        if (formatted === null || formatted === undefined) {
          return '';
        }
        
        const strValue = String(formatted);
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        
        return strValue;
      });
      
      lines.push(values.join(','));
    });

    totalRows += chunk.length;
    skip += chunkSize;

    if (totalRows % 100000 === 0) {
      console.log(`[CSV Export] Processed ${totalRows.toLocaleString()} rows`);
    }
  }

  return lines.join('\n');
}

/**
 * EXPORT STATISTICS TRACKING
 * Untuk monitoring dan optimization
 */
export interface ExportStats {
  startTime: number;
  endTime?: number;
  rowCount: number;
  fileSize: number;
  format: 'xlsx' | 'csv';
  processingTimeMs: number;
  memoryUsageMB: number;
}

export async function captureExportStats(
  fileName: string,
  callback: () => Promise<Buffer | string>
): Promise<{ buffer: Buffer | string; stats: ExportStats }> {
  const startTime = Date.now();
  const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;

  const buffer = await callback();

  const endTime = Date.now();
  const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;

  const stats: ExportStats = {
    startTime,
    endTime,
    rowCount: 0, // Set by caller if needed
    fileSize: typeof buffer === 'string' ? buffer.length : buffer.byteLength,
    format: fileName.endsWith('.xlsx') ? 'xlsx' : 'csv',
    processingTimeMs: endTime - startTime,
    memoryUsageMB: finalMemory - initialMemory,
  };

  console.log('[Export Stats]', {
    file: fileName,
    sizeKB: (stats.fileSize / 1024).toFixed(2),
    timeSec: (stats.processingTimeMs / 1000).toFixed(1),
    memoryMB: stats.memoryUsageMB.toFixed(2),
  });

  return { buffer, stats };
}

/**
 * FORMATTERS untuk common data types
 */
export const ExcelFormatters = {
  date: (value: Date | string) => {
    if (!value) return '';
    const date = typeof value === 'string' ? new Date(value) : value;
    return date.toLocaleDateString('id-ID');
  },

  datetime: (value: Date | string) => {
    if (!value) return '';
    const date = typeof value === 'string' ? new Date(value) : value;
    return date.toLocaleString('id-ID');
  },

  currency: (value: number, currency = 'IDR') => {
    if (!value) return '0';
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
    }).format(value);
  },

  number: (value: number) => {
    if (!value) return '0';
    return new Intl.NumberFormat('id-ID').format(value);
  },

  phone: (value: string) => {
    if (!value) return '';
    // Format phone ke +62 format jika perlu
    return value.startsWith('0') ? '+62' + value.substring(1) : value;
  },

  percentage: (value: number) => {
    if (!value) return '0%';
    return (value * 100).toFixed(2) + '%';
  },
};

/**
 * ERROR HANDLING
 */
export class ExportError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export function validateExportRequest(
  dataSize: number,
  maxSize: number = 1000000
) {
  if (dataSize > maxSize) {
    throw new ExportError(
      'SIZE_EXCEEDED',
      `Export size limited to ${maxSize.toLocaleString()} rows. ` +
      `Current: ${dataSize.toLocaleString()} rows. Please filter data.`,
      400
    );
  }

  if (dataSize === 0) {
    throw new ExportError(
      'NO_DATA',
      'No data available to export',
      400
    );
  }
}
