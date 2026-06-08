import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import {
  getTransactionExportConfig,
  transactionExportErrorResponse,
  validateTransactionExportDateRange,
  validateTransactionExportRowCount,
} from '@/lib/customs/transaction-export-validation';
import {
  contentDispositionFilename,
  generateTransactionExcelBuffer,
  INCOMING_TRANSACTION_COLUMNS,
  INTERNAL_TRANSACTION_COLUMNS,
  OUTGOING_TRANSACTION_COLUMNS,
  TransactionExcelColumn,
} from '@/lib/customs/transaction-excel-export';
import {
  countIncomingRows,
  countInternalRows,
  countOutgoingRows,
  fetchIncomingRows,
  fetchInternalRows,
  fetchOutgoingRows,
  TransactionExportKind,
} from '@/lib/customs/transaction-export-queries';

const EXCEL_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const REPORT_CONFIG: Record<TransactionExportKind, {
  filePrefix: string;
  sheetName: string;
  columns: TransactionExcelColumn[];
}> = {
  incoming: {
    filePrefix: 'Laporan_Pemasukan_Barang',
    sheetName: 'Pemasukan Barang',
    columns: INCOMING_TRANSACTION_COLUMNS,
  },
  outgoing: {
    filePrefix: 'Laporan_Pengeluaran_Barang',
    sheetName: 'Pengeluaran Barang',
    columns: OUTGOING_TRANSACTION_COLUMNS,
  },
  'internal-incoming': {
    filePrefix: 'Internal_Transaction_Incoming',
    sheetName: 'Internal Incoming',
    columns: INTERNAL_TRANSACTION_COLUMNS,
  },
  'internal-outgoing': {
    filePrefix: 'Internal_Transaction_Outgoing',
    sheetName: 'Internal Outgoing',
    columns: INTERNAL_TRANSACTION_COLUMNS,
  },
};

function buildFileName(kind: TransactionExportKind, startDate: string, endDate: string): string {
  return contentDispositionFilename(`${REPORT_CONFIG[kind].filePrefix}_${startDate}_${endDate}.xlsx`);
}

async function countRows(kind: TransactionExportKind, filters: Parameters<typeof countIncomingRows>[0]) {
  if (kind === 'incoming') return countIncomingRows(filters);
  if (kind === 'outgoing') return countOutgoingRows(filters);
  return countInternalRows(kind, filters);
}

async function fetchRows(kind: TransactionExportKind, filters: Parameters<typeof fetchIncomingRows>[0]) {
  if (kind === 'incoming') return fetchIncomingRows(filters);
  if (kind === 'outgoing') return fetchOutgoingRows(filters);
  return fetchInternalRows(kind, filters);
}

export async function handleTransactionExportRequest(
  request: NextRequest,
  kind: TransactionExportKind
): Promise<Response> {
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
    const exportConfig = getTransactionExportConfig();
    const dateRange = validateTransactionExportDateRange({
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      maxRangeDays: exportConfig.maxRangeDays,
    });
    const filters = {
      companyCode: companyValidation.companyCode,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      search: searchParams.get('search')?.trim() || null,
      itemType: searchParams.get('itemType')?.trim() || null,
    };

    const totalRows = await countRows(kind, filters);
    validateTransactionExportRowCount(totalRows, exportConfig.maxRows);

    const rows = await fetchRows(kind, filters);
    const reportConfig = REPORT_CONFIG[kind];
    const buffer = await generateTransactionExcelBuffer({
      rows,
      columns: reportConfig.columns,
      sheetName: reportConfig.sheetName,
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
        'X-Max-Export-Rows': exportConfig.maxRows.toString(),
        'X-Max-Export-Range-Days': exportConfig.maxRangeDays.toString(),
      },
    });
  } catch (error) {
    const validationResponse = transactionExportErrorResponse(error);
    if (validationResponse) return validationResponse;

    console.error(`[Transaction Export Error] Failed to export ${kind}:`, error);
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
