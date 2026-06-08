import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import {
  getMaxExportRows,
  lpjExportErrorResponse,
  validateExportDateRange,
  validateExportRowCount,
} from '@/lib/customs/lpj-export-validation';
import {
  contentDispositionFilename,
  generateLpjExcelBuffer,
  LPJ_MUTATION_COLUMNS,
  LPJ_WIP_COLUMNS,
} from '@/lib/customs/lpj-excel-export';
import {
  countMutationRows,
  countWipRows,
  fetchMutationRows,
  fetchWipRows,
  LpjExportKind,
} from '@/lib/customs/lpj-export-queries';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const REPORT_CONFIG: Record<LpjExportKind, {
  filePrefix: string;
  sheetName: string;
  dateMode: 'single-date' | 'range';
}> = {
  wip: {
    filePrefix: 'Laporan_Posisi_Barang_Dalam_Proses',
    sheetName: 'Laporan WIP',
    dateMode: 'single-date',
  },
  'raw-material': {
    filePrefix: 'Laporan_Bahan_Baku',
    sheetName: 'Laporan Bahan Baku',
    dateMode: 'range',
  },
  production: {
    filePrefix: 'Laporan_Hasil_Produksi',
    sheetName: 'Laporan Produksi',
    dateMode: 'range',
  },
  scrap: {
    filePrefix: 'Laporan_Barang_Scrap',
    sheetName: 'Laporan Scrap',
    dateMode: 'range',
  },
  'capital-goods': {
    filePrefix: 'Laporan_Barang_Modal',
    sheetName: 'Laporan Barang Modal',
    dateMode: 'range',
  },
};

function buildFileName(kind: LpjExportKind, startDate: string, endDate: string): string {
  const config = REPORT_CONFIG[kind];
  const period = startDate === endDate ? startDate : `${startDate}_${endDate}`;
  return contentDispositionFilename(`${config.filePrefix}_${period}.xlsx`);
}

export async function handleLpjExportRequest(request: NextRequest, kind: LpjExportKind): Promise<Response> {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }

    const { searchParams } = new URL(request.url);
    const config = REPORT_CONFIG[kind];
    const dateRange = validateExportDateRange({
      mode: config.dateMode,
      stockDate: searchParams.get('stockDate'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
    });
    const filters = {
      companyCode: companyValidation.companyCode,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      search: searchParams.get('search')?.trim() || null,
      itemType: searchParams.get('itemType')?.trim() || null,
    };
    const maxRows = getMaxExportRows();

    const totalRows = kind === 'wip'
      ? await countWipRows(filters)
      : await countMutationRows(kind, filters);

    validateExportRowCount(totalRows, maxRows);

    const rows = kind === 'wip'
      ? await fetchWipRows(filters)
      : await fetchMutationRows(kind, filters);

    const buffer = await generateLpjExcelBuffer({
      rows,
      columns: kind === 'wip' ? LPJ_WIP_COLUMNS : LPJ_MUTATION_COLUMNS,
      sheetName: config.sheetName,
    });
    const fileName = buildFileName(kind, dateRange.startDateString, dateRange.endDateString);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': EXCEL_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.byteLength.toString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Total-Rows': totalRows.toString(),
        'X-Max-Export-Rows': maxRows.toString(),
      },
    });
  } catch (error) {
    const validationResponse = lpjExportErrorResponse(error);
    if (validationResponse) return validationResponse;

    console.error(`[LPJ Export Error] Failed to export ${kind}:`, error);
    return NextResponse.json(
      {
        success: false,
        code: 'EXPORT_FAILED',
        message: 'Export failed. Please narrow the filters or try again.',
      },
      { status: 500 }
    );
  }
}
