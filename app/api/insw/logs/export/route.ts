import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

// Single-process admission for the existing buffered path. No waiting queue.
let exportActive = false;

export async function GET(request: Request) {
  let admitted = false;
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

    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (exportActive) {
      return NextResponse.json(
        { success: false, error: 'An INSW Excel export is already running. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': '5' } }
      );
    }
    exportActive = true;
    admitted = true;

    const { companyCode } = companyValidation;
    const { searchParams } = new URL(request.url);

    const transactionType = searchParams.get('transaction_type');
    const inswStatus = searchParams.get('insw_status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const wmsId = searchParams.get('wms_id')?.trim();
    const service = new INSWTransmissionService();

    const logs = await service.getTransmissionLogsForExcel({
      company_code: companyCode,
      transaction_type: transactionType || undefined,
      insw_status: inswStatus || undefined,
      wms_id: wmsId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });

    // This single bounded probe includes one sentinel row; never silently truncate.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (logs.length > 10000) {
      return NextResponse.json(
        { success: false, error: 'More than 10,000 logs match. Narrow the active filters and try again. The 100,000-row export is pending capacity validation.' },
        { status: 413 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('INSW Logs');

    worksheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Sent At', key: 'sent_at', width: 22 },
      { header: 'Type', key: 'type', width: 18 },
      { header: 'WMS ID', key: 'wms_id', width: 24 },
      { header: 'Activity', key: 'activity', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Retries', key: 'retries', width: 10 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E1F2' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    logs.forEach((log, index) => {
      worksheet.addRow({
        no: index + 1,
        sent_at: log.sent_at ? dayjs(log.sent_at).format('DD/MM/YYYY HH:mm:ss') : '',
        type: log.transaction_type,
        wms_id: log.wms_id ?? '',
        activity: log.insw_activity_code ?? '',
        status: log.insw_status,
        retries: log.retry_count,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    if (request.signal.aborted) return new Response(null, { status: 499 });
    const filenamePart = (value: string | null) => value?.replace(/[^0-9A-Za-z-]/g, '_') || 'all';
    const filenameDateFrom = filenamePart(dateFrom);
    const filenameDateTo = filenamePart(dateTo);
    const filename = `insw-logs-${filenameDateFrom}-to-${filenameDateTo}.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });
  } catch {
    console.error('Error exporting INSW logs');
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to export INSW logs. Please try again or narrow the active filters.',
      },
      { status: 500 }
    );
  } finally {
    // An aborted Prisma query cannot be canceled here: retain admission until
    // its work settles, so repeated disconnects cannot bypass the bound.
    if (admitted) exportActive = false;
  }
}
