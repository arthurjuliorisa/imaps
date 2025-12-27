import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import prisma from '@/lib/db';
import * as XLSX from 'xlsx';

interface ExcelRow {
  Date?: string | number;
  'Scrap Code'?: string;
  'Scrap Name'?: string;
  UOM?: string;
  Quantity?: number;
  Currency?: string;
  Amount?: number;
  Remarks?: string;
}

interface ImportItem {
  date: string;
  scrapCode: string;
  scrapName: string;
  uom: string;
  qty: number;
  currency: string;
  amount: number;
  remarks?: string;
}

function generateWmsId(type: 'IN' | 'OUT'): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `SCRAP-${type}-${timestamp}-${random}`;
}

function calculatePriority(companyCode: number): number {
  const companyString = companyCode.toString().padStart(4, '0');
  return parseInt(companyString);
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkAuth(request);
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Parse FormData
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { message: 'No file uploaded' },
        { status: 400 }
      );
    }

    if (!file.name.endsWith('.xlsx')) {
      return NextResponse.json(
        { message: 'Invalid file format. Please upload an Excel file (.xlsx)' },
        { status: 400 }
      );
    }

    // Read and parse Excel file
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

    if (jsonData.length === 0) {
      return NextResponse.json(
        { message: 'Excel file is empty' },
        { status: 400 }
      );
    }

    const companyCode = authResult.user.companyCode;

    // Get company info
    const company = await prisma.company.findUnique({
      where: { company_code: companyCode },
      select: { company_name: true },
    });

    if (!company) {
      return NextResponse.json(
        { message: 'Company not found' },
        { status: 404 }
      );
    }

    // Validate and transform data
    const validationErrors: string[] = [];
    const items: ImportItem[] = [];

    jsonData.forEach((row, index) => {
      const rowNumber = index + 2; // +2 because row 1 is header

      // Validate required fields
      if (!row.Date) {
        validationErrors.push(`Row ${rowNumber}: Date is required`);
      }
      if (!row['Scrap Code']) {
        validationErrors.push(`Row ${rowNumber}: Scrap Code is required`);
      }
      if (!row['Scrap Name']) {
        validationErrors.push(`Row ${rowNumber}: Scrap Name is required`);
      }
      if (!row.UOM) {
        validationErrors.push(`Row ${rowNumber}: UOM is required`);
      }
      if (!row.Quantity || row.Quantity <= 0) {
        validationErrors.push(`Row ${rowNumber}: Quantity must be greater than 0`);
      }
      if (!row.Currency) {
        validationErrors.push(`Row ${rowNumber}: Currency is required`);
      }
      if (row.Amount === undefined || row.Amount === null || row.Amount < 0) {
        validationErrors.push(`Row ${rowNumber}: Amount must be non-negative`);
      }

      // Validate currency
      const validCurrencies = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];
      if (row.Currency && !validCurrencies.includes(row.Currency)) {
        validationErrors.push(
          `Row ${rowNumber}: Invalid currency. Must be one of: ${validCurrencies.join(', ')}`
        );
      }

      // Add to items array
      items.push({
        date: row.Date ? String(row.Date) : '',
        scrapCode: row['Scrap Code'] || '',
        scrapName: row['Scrap Name'] || '',
        uom: row.UOM || '',
        qty: Number(row.Quantity) || 0,
        currency: row.Currency || 'USD',
        amount: Number(row.Amount) || 0,
        remarks: row.Remarks || '',
      });
    });

    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          message: 'Import gagal karena ada error validasi',
          errors: validationErrors,
        },
        { status: 400 }
      );
    }

    // Process all items in a transaction
    const importedItems = await prisma.$transaction(async (tx) => {
      const results = [];

      for (const item of items) {
        const wmsId = generateWmsId('IN');
        const priority = calculatePriority(companyCode);

        // Create scrap transaction
        const transaction = await tx.scrap_transactions.create({
          data: {
            company_code: companyCode,
            company_name: company.company_name,
            direction: 'IN',
            doc_type: 'SCRAP-IN',
            wms_id: wmsId,
            created_by: authResult.user!.username,
            updated_by: authResult.user!.username,
          },
        });

        // Create scrap transaction item
        await tx.scrap_transaction_items.create({
          data: {
            transaction_id: transaction.id,
            date: new Date(item.date),
            item_type: 'SCRAP',
            item_code: item.scrapCode,
            item_name: item.scrapName,
            unit: item.uom,
            in_qty: item.qty,
            out_qty: 0,
            currency: item.currency,
            value_amount: item.amount,
            remarks: item.remarks || '',
          },
        });

        // Queue snapshot recalculation
        await tx.snapshot_recalculation_queue.create({
          data: {
            company_code: companyCode,
            priority: priority,
            status: 'pending',
            triggered_by: `scrap_incoming_import:${wmsId}`,
            created_at: new Date(),
          },
        });

        results.push({
          wmsId,
          scrapCode: item.scrapCode,
          qty: item.qty,
        });
      }

      return results;
    });

    return NextResponse.json({
      message: `Successfully imported ${importedItems.length} incoming scrap transaction(s)`,
      data: {
        importedCount: importedItems.length,
        items: importedItems,
      },
    });
  } catch (error) {
    console.error('Error importing incoming scrap transactions:', error);
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : 'Failed to import incoming scrap transactions',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
