import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

/**
 * GET /api/customs/scrap/template
 * Generates and downloads an Excel template file for scrap mutation imports
 *
 * Returns:
 * - Excel file (.xlsx) with proper formatting and sample data
 * - Headers: Date, Item Code, Incoming, Remarks
 * - Includes format hints and sample data rows
 * - Contains an additional Instructions sheet
 */
export async function GET() {
  try {
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // ============================================
    // SHEET 1: Scrap Import Template (Main Sheet)
    // ============================================

    const worksheet = workbook.addWorksheet('Scrap Import Template');

    // Define headers
    const headers = ['Date', 'Scrap Code', 'Incoming', 'Remarks'];

    // Define format hints (row 2)
    const formatHints = ['YYYY-MM-DD', 'e.g., SCRAP-001', 'Positive number', 'Optional notes'];

    // Define sample data (rows 3-5)
    const sampleData = [
      [new Date('2025-01-15'), 'SCRAP-001', 50, 'New scrap received'],
      [new Date('2025-01-16'), 'SCRAP-002', 75, 'Additional scrap'],
      [new Date('2025-01-17'), 'SCRAP-001', 30, 'Daily intake'],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 15 },  // Date column
      { width: 20 },  // Scrap Code column
      { width: 15 },  // Incoming column
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

    // Format Incoming column (C3:C5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`C${row}`).numFmt = '0.00';
    }

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsWorksheet = workbook.addWorksheet('Instructions');

    const instructionsData = [
      ['Scrap Mutation Import Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your scrap mutation data starting from Row 3 (after the format hints)'],
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
      ['  - Cannot be in the future'],
      [],
      ['Scrap Code:'],
      ['  - The unique code of the Scrap Master (e.g., SCRAP-001)'],
      ['  - Required field'],
      ['  - Must exist in the Scrap Master data'],
      ['  - Case sensitive'],
      [],
      ['Incoming:'],
      ['  - The quantity of incoming scrap'],
      ['  - Required field'],
      ['  - Must be a positive number greater than 0 (can include decimals)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Remarks:'],
      ['  - Optional notes about the scrap mutation'],
      ['  - Maximum 1000 characters'],
      ['  - Can be left empty'],
      [],
      ['Validation Rules:'],
      ['  - Date and Scrap Code combination must be unique'],
      ['  - All Scrap Codes must exist in the Scrap Master data'],
      ['  - Incoming values must be > 0'],
      ['  - Date cannot be in the future'],
      [],
      ['Important Notes:'],
      ['  - Do NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during import'],
      ['  - The system will automatically calculate beginning and ending balances'],
      ['  - Empty rows will be skipped during import'],
      ['  - If an error occurs for any row, the entire import will be rolled back'],
      [],
      ['Example Data:'],
      ['Date         | Scrap Code  | Incoming | Remarks'],
      ['2025-01-15   | SCRAP-001   | 50       | New scrap received'],
      ['2025-01-16   | SCRAP-002   | 75.50    | Additional scrap from production'],
      ['2025-01-17   | SCRAP-001   | 30       | Daily intake'],
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
    const sectionHeaderRows = [3, 9, 11, 17, 23, 29, 33, 42];
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
    const filename = `Scrap_Import_Template_${timestamp}.xlsx`;

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
    console.error('[API Error] Failed to generate scrap import template:', error);

    return NextResponse.json(
      {
        message: 'Error generating Excel template',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
