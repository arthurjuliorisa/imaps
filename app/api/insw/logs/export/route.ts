import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

export async function GET(request: Request) {
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

    const { companyCode } = companyValidation;
    const { searchParams } = new URL(request.url);

    const transactionType = searchParams.get('transaction_type');
    const inswStatus = searchParams.get('insw_status');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    const logs = await service.getTransmissionLogs({
      company_code: companyCode,
      transaction_type: transactionType || undefined,
      insw_status: inswStatus || undefined,
      limit: 10000,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });

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

    const filenameDateFrom = dateFrom ?? 'all';
    const filenameDateTo = dateTo ?? 'all';
    const filename = `insw-logs-${filenameDateFrom}-to-${filenameDateTo}.xlsx`;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });
  } catch (error: any) {
    console.error('Error exporting INSW logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
