import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

/**
 * GET /api/customs/capital-goods/template
 * Generates and downloads an Excel template file for capital goods outgoing imports
 *
 * Returns:
 * - Excel file (.xlsx) with proper formatting and sample data
 * - Headers: Date, Item Code, Recipient Name, Qty, Currency, Value Amount, Remarks
 * - Includes format hints and sample data rows
 * - Contains an additional Instructions sheet
 */
export async function GET() {
  try {
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // ============================================
    // SHEET 1: Capital Goods Outgoing Import Template (Main Sheet)
    // ============================================

    const worksheet = workbook.addWorksheet('Capital Goods Outgoing');

    // Define headers
    const headers = ['Date', 'Item Code', 'Recipient Name', 'Qty', 'Currency', 'Value Amount', 'Remarks'];

    // Define format hints (row 2)
    const formatHints = ['YYYY-MM-DD', 'e.g., CAPITAL-001', 'Company/Person name', 'Positive number', 'USD/IDR/CNY/EUR/JPY', 'Numeric value', 'Optional notes'];

    // Define sample data (rows 3-5)
    const sampleData = [
      [new Date('2025-01-15'), 'CAPITAL-001', 'ABC Corp', 1, 'USD', 5000, 'Equipment sold'],
      [new Date('2025-01-16'), 'CAPITAL-002', 'XYZ Industries', 2, 'USD', 12000, 'Machinery transfer'],
      [new Date('2025-01-17'), 'CAPITAL-001', 'ABC Corp', 1, 'USD', 5500, 'Additional equipment'],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 15 },  // Date column
      { width: 20 },  // Item Code column
      { width: 25 },  // Recipient Name column
      { width: 10 },  // Qty column
      { width: 12 },  // Currency column
      { width: 15 },  // Value Amount column
      { width: 30 },  // Remarks column
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

    // Format Qty column (D3:D5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`D${row}`).numFmt = '0.00';
    }

    // Format Value Amount column (F3:F5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`F${row}`).numFmt = '#,##0.00';
    }

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsWorksheet = workbook.addWorksheet('Instructions');

    const instructionsData = [
      ['Capital Goods Outgoing Import Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your capital goods outgoing data starting from Row 3 (after the format hints)'],
      ['2. You can delete the sample data rows (3-5) or overwrite them with your actual data'],
      ['3. Add as many rows as needed for your import'],
      ['4. Save the file and upload it through the import function'],
      [],
      ['Column Details:'],
      [],
      ['Date:'],
      ['  - Format: YYYY-MM-DD (e.g., 2025-01-15)'],
      ['  - Required field'],
      ['  - Must be a valid date'],
      ['  - Date cannot be in the future'],
      [],
      ['Item Code:'],
      ['  - The unique code of the capital goods item (e.g., CAPITAL-001)'],
      ['  - Required field'],
      ['  - Must exist in the Beginning Balances master data'],
      ['  - Must be a capital goods type: HIBE_M (Machinery), HIBE_E (Electronics), or HIBE_T (Tools)'],
      ['  - Case sensitive'],
      [],
      ['Recipient Name:'],
      ['  - Name of the company or person receiving the goods'],
      ['  - Required field'],
      ['  - Maximum 200 characters'],
      ['  - Records with the same Date and Recipient Name will be grouped into one transaction'],
      [],
      ['Qty:'],
      ['  - The quantity of outgoing capital goods'],
      ['  - Required field'],
      ['  - Must be a positive number greater than 0 (can include decimals)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Currency:'],
      ['  - Currency code for the value amount'],
      ['  - Required field'],
      ['  - Valid values: USD, IDR, CNY, EUR, JPY'],
      ['  - Case sensitive'],
      [],
      ['Value Amount:'],
      ['  - The monetary value of the outgoing goods'],
      ['  - Required field'],
      ['  - Must be a non-negative number (can include decimals)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Remarks:'],
      ['  - Optional notes about the transaction'],
      ['  - Maximum 500 characters'],
      ['  - Can be left empty'],
      [],
      ['Validation Rules:'],
      ['  - All Item Codes must exist in the system as capital goods items'],
      ['  - Qty must be greater than 0'],
      ['  - Value Amount must be >= 0'],
      ['  - Date cannot be in the future'],
      ['  - Records are grouped by Date + Recipient Name to create transactions'],
      [],
      ['Important Notes:'],
      ['  - Do NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during import'],
      ['  - Records with the same Date and Recipient Name will be combined into one outgoing transaction'],
      ['  - Each unique Date + Recipient Name combination creates one transaction with multiple items'],
      ['  - Empty rows will be skipped during import'],
      ['  - If an error occurs during import, the entire import will be rolled back'],
      ['  - These outgoing transactions will appear in the LPJ Mutasi report'],
      [],
      ['Example Data:'],
      ['Date         | Item Code   | Recipient Name  | Qty  | Currency | Value Amount | Remarks'],
      ['2025-01-15   | CAPITAL-001 | ABC Corp        | 1    | USD      | 5000         | Equipment sold'],
      ['2025-01-16   | CAPITAL-002 | XYZ Industries  | 2    | USD      | 12000        | Machinery transfer'],
      ['2025-01-17   | CAPITAL-001 | ABC Corp        | 1    | USD      | 5500         | Additional equipment'],
      [],
      ['For assistance, please contact the system administrator.'],
    ];

    // Add instructions data
    instructionsData.forEach(row => instructionsWorksheet.addRow(row));

    // Set column width
    instructionsWorksheet.getColumn(1).width = 80;

    // Style title (Row 1)
    instructionsWorksheet.getCell('A1').font = { bold: true, size: 14 };

    // Style section headers
    const sectionHeaderRows = [3, 9, 11, 17, 23, 29, 35, 41, 47, 53, 62];
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
    const filename = `Capital_Goods_Outgoing_Import_Template_${timestamp}.xlsx`;

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
    console.error('[API Error] Failed to generate capital goods outgoing import template:', error);

    return NextResponse.json(
      {
        message: 'Error generating Excel template',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
