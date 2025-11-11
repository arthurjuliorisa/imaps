import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

/**
 * GET /api/customs/capital-goods/template
 * Generates and downloads an Excel template file for capital goods mutation imports
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
    const workbook = XLSX.utils.book_new();

    // ============================================
    // SHEET 1: Capital Goods Import Template (Main Sheet)
    // ============================================

    // Define headers
    const headers = ['Date', 'Item Code', 'Incoming', 'Remarks'];

    // Define format hints (row 2)
    const formatHints = ['YYYY-MM-DD', 'e.g., CAPITAL-001', 'Positive number', 'Optional notes'];

    // Define sample data (rows 3-5)
    const sampleData = [
      ['2025-01-15', 'CAPITAL-001', 50, 'New scrap received'],
      ['2025-01-16', 'CAPITAL-002', 75, 'Additional scrap'],
      ['2025-01-17', 'CAPITAL-001', 30, 'Daily intake'],
    ];

    // Combine all data into a single array of arrays
    const worksheetData = [
      headers,
      formatHints,
      ...sampleData,
    ];

    // Create worksheet from the data
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 15 },  // Date column
      { wch: 20 },  // Item Code column
      { wch: 15 },  // Incoming column
      { wch: 30 },  // Remarks column
    ];

    // Apply styling to headers (Row 1)
    // Note: Basic XLSX library has limited styling support
    // For advanced styling, consider using exceljs instead
    const headerCellAddresses = ['A1', 'B1', 'C1', 'D1'];
    headerCellAddresses.forEach(address => {
      if (!worksheet[address]) return;

      // Set cell style (limited in basic XLSX)
      worksheet[address].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'ADD8E6' } }, // Light blue background
        alignment: { horizontal: 'center', vertical: 'center' },
      };
    });

    // Set number format for Incoming column (C3:C5)
    // Format as number with 2 decimal places
    for (let row = 3; row <= 5; row++) {
      const cellAddress = `C${row}`;
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].z = '0.00';
      }
    }

    // Set date format for Date column (A3:A5)
    for (let row = 3; row <= 5; row++) {
      const cellAddress = `A${row}`;
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].z = 'yyyy-mm-dd';
      }
    }

    // Append the main worksheet to the workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Capital Goods Import Template');

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsData = [
      ['Capital Goods Mutation Import Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your capital goods mutation data starting from Row 3 (after the format hints)'],
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
      [],
      ['Item Code:'],
      ['  - The unique code of the scrap item (e.g., CAPITAL-001)'],
      ['  - Required field'],
      ['  - Must exist in the Item master data'],
      ['  - Case sensitive'],
      [],
      ['Incoming:'],
      ['  - The quantity of incoming scrap'],
      ['  - Required field'],
      ['  - Must be a positive number (can include decimals)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Remarks:'],
      ['  - Optional notes about the capital goods mutation'],
      ['  - Maximum 500 characters recommended'],
      ['  - Can be left empty'],
      [],
      ['Validation Rules:'],
      ['  - Date and Item Code combination must be unique'],
      ['  - All Item Codes must exist in the system'],
      ['  - Incoming values must be >= 0'],
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
      ['Date         | Item Code   | Incoming | Remarks'],
      ['2025-01-15   | CAPITAL-001   | 50       | New scrap received'],
      ['2025-01-16   | CAPITAL-002   | 75.50    | Additional scrap from production'],
      ['2025-01-17   | CAPITAL-001   | 30       | Daily intake'],
      [],
      ['For assistance, please contact the system administrator.'],
    ];

    // Create instructions worksheet
    const instructionsWorksheet = XLSX.utils.aoa_to_sheet(instructionsData);

    // Set column width for instructions sheet
    instructionsWorksheet['!cols'] = [
      { wch: 80 },  // Wide column for instructions
    ];

    // Make the title bold (Row 1)
    if (instructionsWorksheet['A1']) {
      instructionsWorksheet['A1'].s = {
        font: { bold: true, sz: 14 },
        alignment: { horizontal: 'left' },
      };
    }

    // Make section headers bold
    const sectionHeaderRows = ['A3', 'A9', 'A11', 'A17', 'A23', 'A29', 'A33', 'A42'];
    sectionHeaderRows.forEach(address => {
      if (instructionsWorksheet[address]) {
        instructionsWorksheet[address].s = {
          font: { bold: true },
        };
      }
    });

    // Append the instructions worksheet to the workbook
    XLSX.utils.book_append_sheet(workbook, instructionsWorksheet, 'Instructions');

    // ============================================
    // Generate and Send Excel File
    // ============================================

    // Generate buffer from workbook
    const buffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      cellStyles: true, // Enable cell styling (limited support)
    });

    // Create filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Capital Goods_Import_Template_${timestamp}.xlsx`;

    // Return the file as a downloadable response
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=${filename}`,
        'Content-Length': buffer.length.toString(),
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
