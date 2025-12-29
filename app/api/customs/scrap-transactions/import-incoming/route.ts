import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

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

/**
 * Calculate priority for snapshot recalculation queue
 * Backdated transactions (date < today) should have priority 0
 * Same-day transactions (date = today) should have priority -1
 */
function calculatePriority(transactionDate: Date): number {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  ));

  if (transactionDate < today) {
    return 0; // Backdated transaction
  } else if (transactionDate.getTime() === today.getTime()) {
    return -1; // Same-day transaction
  }
  return -1; // Default to same-day priority
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyCode = Number(session.user.companyCode);

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

    // Read and parse Excel file using ExcelJS
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return NextResponse.json(
        { message: 'Excel file is empty or invalid' },
        { status: 400 }
      );
    }

    // Convert worksheet to JSON
    const jsonData: ExcelRow[] = [];
    const headers: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        // First row is headers
        row.eachCell((cell) => {
          headers.push(cell.value?.toString() || '');
        });
      } else {
        // Data rows
        const rowData: any = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            // ExcelJS automatically converts dates to Date objects
            rowData[header] = cell.value;
          }
        });
        if (Object.keys(rowData).length > 0) {
          jsonData.push(rowData as ExcelRow);
        }
      }
    });

    if (jsonData.length === 0) {
      return NextResponse.json(
        { message: 'Excel file is empty' },
        { status: 400 }
      );
    }

    // Helper function to parse date values
    const parseExcelDate = (dateValue: any): Date | null => {
      if (!dateValue) return null;

      // ExcelJS returns Date objects for date cells
      if (dateValue instanceof Date) {
        return dateValue;
      }

      // If it's a string, try to parse it
      if (typeof dateValue === 'string') {
        const parsed = new Date(dateValue);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }

      return null;
    };

    // Validate and transform data
    const validationErrors: string[] = [];
    const items: ImportItem[] = [];

    jsonData.forEach((row, index) => {
      const rowNumber = index + 2; // +2 because row 1 is header

      // Parse date
      const parsedDate = row.Date ? parseExcelDate(row.Date) : null;

      // Validate required fields
      if (!row.Date || !parsedDate) {
        validationErrors.push(`Row ${rowNumber}: Date is required or invalid`);
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
        date: parsedDate ? parsedDate.toISOString() : '',
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
      const now = new Date();

      // Prepare transaction headers
      const transactionHeaders = items.map((item, index) => {
        const timestamp = Date.now() + index;
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const documentNumber = `SCRAP-IN-${timestamp}-${random}`;
        const date = new Date(item.date);

        return {
          company_code: companyCode,
          transaction_date: date,
          transaction_type: 'IN' as const,
          document_number: documentNumber,
          source: item.remarks || `Scrap incoming - ${item.currency} ${item.amount}`,
          remarks: item.remarks,
          timestamp: now,
          _documentNumber: documentNumber,
          _date: date,
          _item: item,
        };
      });

      // Create all transaction headers using createMany
      await tx.scrap_transactions.createMany({
        data: transactionHeaders.map(({ _documentNumber, _date, _item, ...header }) => header),
      });

      // Get created transactions to get their IDs
      const createdTransactions = await tx.scrap_transactions.findMany({
        where: {
          company_code: companyCode,
          document_number: {
            in: transactionHeaders.map(h => h.document_number),
          },
        },
        orderBy: { id: 'asc' },
      });

      // Create transaction items using createMany
      const transactionItems = transactionHeaders.map((header, index) => {
        const transaction = createdTransactions[index];
        return {
          scrap_transaction_id: transaction.id,
          scrap_transaction_company: companyCode,
          scrap_transaction_date: header._date,
          item_type: 'SCRAP',
          item_code: header._item.scrapCode,
          item_name: header._item.scrapName,
          uom: header._item.uom,
          qty: new Prisma.Decimal(header._item.qty),
          currency: header._item.currency as 'USD' | 'IDR' | 'CNY' | 'EUR' | 'JPY',
          amount: new Prisma.Decimal(header._item.amount),
          scrap_reason: header._item.remarks,
        };
      });

      await tx.scrap_transaction_items.createMany({
        data: transactionItems,
      });

      // Queue snapshot recalculation for unique item-date combinations
      const uniqueRecalcEntries = new Map<string, any>();

      for (const header of transactionHeaders) {
        const key = `${companyCode}-${header._date.toISOString()}-SCRAP-${header._item.scrapCode}`;
        const priority = calculatePriority(header._date);

        if (!uniqueRecalcEntries.has(key)) {
          uniqueRecalcEntries.set(key, {
            company_code: companyCode,
            item_type: 'SCRAP',
            item_code: header._item.scrapCode,
            recalc_date: header._date,
            status: 'PENDING',
            priority: priority,
            reason: `Incoming scrap import: ${header.document_number}`,
          });
        }
      }

      // Upsert snapshot recalc queue entries
      for (const entry of uniqueRecalcEntries.values()) {
        await tx.snapshot_recalc_queue.upsert({
          where: {
            company_code_recalc_date_item_type_item_code: {
              company_code: entry.company_code,
              recalc_date: entry.recalc_date,
              item_type: entry.item_type,
              item_code: entry.item_code,
            },
          },
          create: entry,
          update: {
            status: entry.status,
            priority: entry.priority,
            reason: entry.reason,
            queued_at: new Date(),
          },
        });
      }

      return transactionHeaders.map(header => ({
        documentNumber: header.document_number,
        scrapCode: header._item.scrapCode,
        qty: header._item.qty,
      }));
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
