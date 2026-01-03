import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
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

/**
 * Handle snapshot recalculation in transaction
 * Returns the date and whether it's backdated for later direct execution
 */
async function handleTxSnapshotRecalc(
  tx: any,
  companyCode: number,
  date: Date,
  reason: string
): Promise<{ date: Date; isBackdated: boolean }> {
  const priority = calculatePriority(date);
  const isBackdated = priority === 0;

  const existingQueue = await tx.snapshot_recalc_queue.findFirst({
    where: {
      company_code: companyCode,
      recalc_date: date,
      item_type: null,
      item_code: null,
    },
  });

  if (existingQueue) {
    await tx.snapshot_recalc_queue.update({
      where: { id: existingQueue.id },
      data: {
        status: 'PENDING',
        priority: priority,
        reason: reason,
        queued_at: new Date(),
      },
    });
  } else {
    await tx.snapshot_recalc_queue.create({
      data: {
        company_code: companyCode,
        item_type: null,
        item_code: null,
        recalc_date: date,
        status: 'PENDING',
        priority: priority,
        reason: reason,
      },
    });
  }

  return { date, isBackdated };
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

    // ... existing code ...

    // Collect backdated dates for direct execution
    let backdatedDates: Date[] = [];

    // Parse FormData
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      return NextResponse.json(
        { 
          message: 'Failed to parse form data. Make sure you uploaded a valid file.',
          errors: ['Invalid request format']
        },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { 
          message: 'No file uploaded',
          errors: ['Please select a file to import']
        },
        { status: 400 }
      );
    }

    if (!file.name.endsWith('.xlsx')) {
      return NextResponse.json(
        { 
          message: 'Invalid file format',
          errors: ['Please upload an Excel file (.xlsx)']
        },
        { status: 400 }
      );
    }

    // Read and parse Excel file using ExcelJS
    let arrayBuffer: ArrayBuffer;
    let buffer: Buffer;
    let workbook: ExcelJS.Workbook;
    let worksheet: ExcelJS.Worksheet | undefined;

    try {
      arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      worksheet = workbook.worksheets[0];
    } catch (error) {
      console.error('Excel parsing error:', error);
      return NextResponse.json(
        { 
          message: 'Failed to parse Excel file',
          errors: ['The Excel file is corrupted or in an invalid format. Please check your file and try again.']
        },
        { status: 400 }
      );
    }

    if (!worksheet) {
      return NextResponse.json(
        { 
          message: 'Excel file is empty',
          errors: ['The Excel file has no data. Please check your file and try again.']
        },
        { status: 400 }
      );
    }

    // Convert worksheet to JSON
    let jsonData: ExcelRow[] = [];
    let headers: string[] = [];

    try {
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          // First row is headers
          row.eachCell((cell) => {
            headers.push(cell.value?.toString() || '');
          });
        } else if (rowNumber === 2) {
          // Row 2 is example data, skip it
        } else {
          // Data rows start from row 3
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
    } catch (error) {
      console.error('Error reading Excel rows:', error);
      return NextResponse.json(
        { 
          message: 'Failed to read Excel data',
          errors: ['There was an error reading the Excel file. Please check the file format.']
        },
        { status: 400 }
      );
    }

    if (jsonData.length === 0) {
      return NextResponse.json(
        { 
          message: 'Excel file is empty',
          errors: ['No data rows found in the Excel file. Please add data starting from row 2.']
        },
        { status: 400 }
      );
    }

    // Fetch all valid scrap items for this company
    let validScrapItems: Array<{ scrap_code: string; scrap_name: string }> = [];
    try {
      validScrapItems = await prisma.scrap_items.findMany({
        where: {
          company_code: companyCode,
          is_active: true,
        },
        select: {
          scrap_code: true,
          scrap_name: true,
        },
      });
    } catch (error) {
      console.error('Error fetching scrap items:', error);
      return NextResponse.json(
        { 
          message: 'Failed to validate scrap items',
          errors: ['Unable to verify scrap items in the system. Please try again.']
        },
        { status: 400 }
      );
    }

    // Create a map for quick lookup
    const scrapItemMap = new Map(validScrapItems.map(item => [item.scrap_code, item.scrap_name]));

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
      const rowNumber = index + 3; // +3 because row 1 is header, row 2 is example

      // Parse date
      const parsedDate = row.Date ? parseExcelDate(row.Date) : null;

      // Validate required fields
      if (!row.Date || !parsedDate) {
        validationErrors.push(`Row ${rowNumber}: Date is required or invalid`);
      }
      if (!row['Scrap Code']) {
        validationErrors.push(`Row ${rowNumber}: Scrap Code is required`);
      }
      
      // Validate scrap code exists in scrap_items
      if (row['Scrap Code'] && !scrapItemMap.has(row['Scrap Code'])) {
        validationErrors.push(
          `Row ${rowNumber}: Scrap Code '${row['Scrap Code']}' does not exist in the system. Please add it to the Scrap Items master data first.`
        );
      }
      
      // Validate scrap name matches the one in database
      if (row['Scrap Code'] && row['Scrap Name'] && scrapItemMap.has(row['Scrap Code'])) {
        const expectedName = scrapItemMap.get(row['Scrap Code']);
        if (row['Scrap Name'] !== expectedName) {
          validationErrors.push(
            `Row ${rowNumber}: Scrap Name '${row['Scrap Name']}' does not match the registered name '${expectedName}' for code '${row['Scrap Code']}'`
          );
        }
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
    let importedItems: any;
    try {
      importedItems = await prisma.$transaction(async (tx) => {
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
        try {
          await tx.scrap_transactions.createMany({
            data: transactionHeaders.map(({ _documentNumber, _date, _item, ...header }) => header),
          });
        } catch (error) {
          console.error('Error creating scrap transactions:', error);
          throw new Error('Failed to create scrap transaction records. Please check your data and try again.');
        }

        // Get created transactions to get their IDs
        let createdTransactions;
        try {
          createdTransactions = await tx.scrap_transactions.findMany({
            where: {
              company_code: companyCode,
              document_number: {
                in: transactionHeaders.map(h => h.document_number),
              },
            },
            orderBy: { id: 'asc' },
          });
        } catch (error) {
          console.error('Error fetching created transactions:', error);
          throw new Error('Failed to retrieve created transactions. Please try again.');
        }

        if (createdTransactions.length === 0) {
          throw new Error('No transactions were created. Please check your data and try again.');
        }

        // Create transaction items using createMany
        const transactionItems = transactionHeaders.map((header, index) => {
          const transaction = createdTransactions[index];
          if (!transaction) {
            throw new Error(`Transaction record not found for item ${index + 1}. Please try again.`);
          }
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

        try {
          await tx.scrap_transaction_items.createMany({
            data: transactionItems,
          });
        } catch (error) {
          console.error('Error creating scrap transaction items:', error);
          throw new Error('Failed to create transaction items. Please check your data and try again.');
        }

        // Queue snapshot recalculation and track backdated dates
        // Note: item_type and item_code are set to NULL because calculate_stock_snapshot
        // recalculates ALL items for a given company+date, not per-item
        const uniqueRecalcEntries = new Map<string, { date: Date; reason: string }>();
        const processedDates = new Set<string>();

        for (const header of transactionHeaders) {
          const dateKey = `${companyCode}-${header._date.toISOString()}`;
          
          if (!processedDates.has(dateKey)) {
            processedDates.add(dateKey);
            uniqueRecalcEntries.set(dateKey, {
              date: header._date,
              reason: `Incoming scrap batch for ${header._date.toISOString().split('T')[0]}`,
            });
          }
        }

        // Queue and track backdated dates
        for (const entry of uniqueRecalcEntries.values()) {
          try {
            const recalcInfo = await handleTxSnapshotRecalc(
              tx,
              companyCode,
              entry.date,
              entry.reason
            );
            if (recalcInfo.isBackdated) {
              backdatedDates.push(recalcInfo.date);
            }
          } catch (error) {
            console.error('Error queuing snapshot recalculation:', error);
          }
        }

        return transactionHeaders.map(header => ({
          documentNumber: header.document_number,
          scrapCode: header._item.scrapCode,
          qty: header._item.qty,
        }));
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      });
    } catch (error) {
      console.error('Transaction error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process import transaction';
      return NextResponse.json(
        { 
          message: errorMessage,
          errors: [errorMessage]
        },
        { status: 400 }
      );
    }

    // Execute direct snapshot recalculation for backdated transactions (outside transaction)
    if (backdatedDates.length > 0) {
      const uniqueDates = Array.from(new Set(backdatedDates.map(d => d.getTime()))).map(t => new Date(t));
      for (const date of uniqueDates) {
        try {
          await prisma.$executeRawUnsafe(
            'SELECT calculate_stock_snapshot($1::int, $2::date)',
            companyCode,
            date
          );
          console.log(
            '[API Info] Backdated snapshot recalculation executed',
            {
              companyCode,
              date: date.toISOString().split('T')[0],
            }
          );
        } catch (recalcError) {
          console.warn(
            '[API Warning] Backdated snapshot recalculation failed',
            {
              companyCode,
              date: date.toISOString().split('T')[0],
              errorMessage: recalcError instanceof Error ? recalcError.message : String(recalcError),
            }
          );
        }
      }
    }

    // Log activity
    await logActivity({
      action: 'IMPORT_SCRAP_TRANSACTIONS',
      description: `Imported ${importedItems.length} incoming scrap transaction(s) from Excel`,
      status: 'success',
      metadata: {
        importedCount: importedItems.length,
        fileName: file.name,
        companyCode,
      },
    });

    return NextResponse.json({
      message: `Successfully imported ${importedItems.length} incoming scrap transaction(s)`,
      data: {
        importedCount: importedItems.length,
        items: importedItems,
      },
    });
  } catch (error: any) {
    console.error('Error importing incoming scrap transactions:', error);
    
    // Ensure we always return a JSON response
    const errorMessage = error instanceof Error ? error.message : 'Failed to import incoming scrap transactions';
    const statusCode = error.statusCode || 500;
    
    return NextResponse.json(
      {
        message: errorMessage,
        errors: [errorMessage],
      },
      { status: statusCode }
    );
  }
}
