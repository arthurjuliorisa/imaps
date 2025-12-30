import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

/**
 * GET /api/customs/scrap-transactions/import-incoming/template
 * Generates and downloads an Excel template file for incoming scrap transaction imports
 *
 * Returns:
 * - Excel file (.xlsx) with proper formatting and sample data
 * - Headers: Date, Scrap Code, Scrap Name, UOM, Quantity, Currency, Amount, Remarks
 * - Includes format hints and sample data rows
 * - Contains an additional Instructions sheet
 */
export async function GET() {
  try {
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // ============================================
    // SHEET 1: Incoming Scrap Template (Main Sheet)
    // ============================================

    const worksheet = workbook.addWorksheet('Incoming Scrap Template');

    // Define headers
    const headers = [
      'Date',
      'Scrap Code',
      'Scrap Name',
      'UOM',
      'Quantity',
      'Currency',
      'Amount',
      'Remarks'
    ];

    // Define format hints (row 2)
    const formatHints = [
      'YYYY-MM-DD',
      'e.g., SCRAP-001',
      'Item name',
      'KG, PCS',
      'Number > 0',
      'USD, IDR, CNY, EUR, JPY',
      'Number ≥ 0',
      'Optional notes'
    ];

    // Define sample data (rows 3-5)
    const sampleData = [
      [
        new Date('2025-01-15'),
        'SCRAP-COMPOSITE-001',
        'Mixed Textile Scrap Grade A',
        'KG',
        50,
        'USD',
        5000,
        'New scrap received'
      ],
      [
        new Date('2025-01-16'),
        'SCRAP-COMPOSITE-002',
        'Production Waste Composite',
        'KG',
        75.5,
        'IDR',
        100000,
        'Additional scrap'
      ],
      [
        new Date('2025-01-17'),
        'SCRAP-COMPOSITE-001',
        'Mixed Textile Scrap Grade A',
        'KG',
        30,
        'USD',
        3000,
        'Daily intake'
      ],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 15 },  // Date
      { width: 25 },  // Scrap Code
      { width: 30 },  // Scrap Name
      { width: 10 },  // UOM
      { width: 12 },  // Quantity
      { width: 12 },  // Currency
      { width: 15 },  // Amount
      { width: 30 },  // Remarks
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFADD8E6' },
    };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Format Date column (A3:A5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`A${row}`).numFmt = 'yyyy-mm-dd';
    }

    // Format Quantity column (E3:E5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`E${row}`).numFmt = '0.00';
    }

    // Format Amount column (G3:G5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`G${row}`).numFmt = '0.00';
    }

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsWorksheet = workbook.addWorksheet('Instructions');

    const instructionsData = [
      ['Incoming Scrap Transaction Import Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your incoming scrap transaction data starting from Row 3 (after the format hints)'],
      ['2. You can delete the sample data rows (3-5) or overwrite them with your actual data'],
      ['3. Add as many rows as needed for your import'],
      ['4. Save the file and upload it through the import function'],
      [],
      ['Column Details:'],
      [],
      ['Date:'],
      ['  - Format: YYYY-MM-DD (e.g., 2025-01-15) or DD/MM/YYYY (e.g., 27/12/2025)'],
      ['  - Required field'],
      ['  - Must be a valid date'],
      ['  - Cannot be in the future'],
      [],
      ['Scrap Code:'],
      ['  - The unique code from scrap master (e.g., SCRAP-COMPOSITE-001)'],
      ['  - Required field'],
      ['  - Must exist in the Scrap Master data'],
      ['  - Case sensitive'],
      [],
      ['Scrap Name:'],
      ['  - The name of the scrap item'],
      ['  - Required field'],
      ['  - Must match the scrap code'],
      [],
      ['UOM:'],
      ['  - Unit of measure (e.g., KG, PCS, SET)'],
      ['  - Required field'],
      ['  - Must match the UOM in scrap master'],
      [],
      ['Quantity:'],
      ['  - The quantity of incoming scrap'],
      ['  - Required field'],
      ['  - Must be a positive number greater than 0 (can include decimals)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Currency:'],
      ['  - Currency code: USD, IDR, CNY, EUR, or JPY'],
      ['  - Required field'],
      ['  - Must be one of the supported currencies'],
      [],
      ['Amount:'],
      ['  - Transaction amount'],
      ['  - Required field'],
      ['  - Must be a non-negative number (≥ 0)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Remarks:'],
      ['  - Optional notes about the transaction'],
      ['  - Maximum 1000 characters'],
      ['  - Can be left empty'],
      [],
      ['Validation Rules:'],
      ['  - All required fields must be filled'],
      ['  - All Scrap Codes must exist in the Scrap Master data'],
      ['  - Quantity must be > 0'],
      ['  - Amount must be ≥ 0'],
      ['  - Currency must be valid (USD, IDR, CNY, EUR, JPY)'],
      ['  - Date cannot be in the future'],
      [],
      ['Important Notes:'],
      ['  - Do NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during import'],
      ['  - The system will automatically update stock balances'],
      ['  - Empty rows will be skipped during import'],
      ['  - If an error occurs for any row, the entire import will be rolled back'],
      [],
      ['Example Data:'],
      ['Date         | Scrap Code          | Scrap Name                 | UOM | Quantity | Currency | Amount | Remarks'],
      ['2025-01-15   | SCRAP-COMPOSITE-001 | Mixed Textile Scrap Grade A| KG  | 50       | USD      | 5000   | New scrap received'],
      ['2025-01-16   | SCRAP-COMPOSITE-002 | Production Waste Composite | KG  | 75.50    | IDR      | 100000 | Additional scrap'],
      ['2025-01-17   | SCRAP-COMPOSITE-001 | Mixed Textile Scrap Grade A| KG  | 30       | USD      | 3000   | Daily intake'],
      [],
      ['For assistance, please contact the system administrator.'],
    ];

    // Add instructions data
    instructionsData.forEach(row => instructionsWorksheet.addRow(row));

    // Set column width
    instructionsWorksheet.getColumn(1).width = 100;

    // Style title (Row 1)
    instructionsWorksheet.getCell('A1').font = { bold: true, size: 14 };

    // Style section headers
    const sectionHeaderRows = [3, 9, 11, 17, 23, 29, 35, 41, 47, 53, 59, 67, 71];
    sectionHeaderRows.forEach(rowNumber => {
      instructionsWorksheet.getRow(rowNumber).font = { bold: true };
    });

    // ============================================
    // Generate and Send Excel File
    // ============================================

    // Generate buffer from workbook
    const buffer = await workbook.xlsx.writeBuffer();

    // Create filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Incoming_Scrap_Template_${timestamp}.xlsx`;

    // Return the file as a downloadable response
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${filename}`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });

  } catch (error) {
    console.error('[API Error] Failed to generate incoming scrap transaction template:', error);

    return NextResponse.json(
      {
        message: 'Error generating Excel template',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
