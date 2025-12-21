import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import ExcelJS from 'exceljs';

/**
 * GET /api/customs/beginning-data/template
 * Generates and downloads a unified Excel template file for beginning balance imports
 *
 * Returns:
 * - Excel file (.xlsx) with proper formatting and sample data for all item types
 * - Headers: Item Type, Item Code, Item Name, UOM, Qty, Balance Date, Remarks
 * - Includes format hints and sample data rows for multiple item types
 * - Contains an additional Instructions sheet
 */
export async function GET() {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // ============================================
    // SHEET 1: Beginning Data Import Template (Main Sheet)
    // ============================================

    const worksheet = workbook.addWorksheet('Beginning Data Template');

    // Define headers - MUST match what frontend parser expects
    const headers = [
      'Item Code',
      'Beginning Balance',
      'Beginning Date',
      'Remarks'
    ];

    // Define format hints (row 2)
    const formatHints = [
      'e.g., RM-001, FG-001, CG-001',
      'Positive number > 0',
      'DD/MM/YYYY',
      'Optional notes'
    ];

    // Define sample data (rows 3-8) - showcasing different item types
    const sampleData = [
      ['RM-1310-001', 100, '01/01/2025', 'Opening balance for raw materials'],
      ['FG-1310-001', 250.5, '01/01/2025', 'Initial finished goods stock'],
      ['CG-MACH-001', 2, '01/01/2025', 'Capital goods - Machine'],
      ['WIP-1310-001', 150, '01/01/2025', 'WIP stock'],
      ['SCRAP-1310-001', 10, '01/01/2025', 'Waste materials'],
      ['CG-EQUIP-001', 5, '01/01/2025', 'Quality control equipment'],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 20 },  // Item Code column
      { width: 20 },  // Beginning Balance column
      { width: 18 },  // Beginning Date column
      { width: 40 },  // Remarks column
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFADD8E6' }, // Light blue
    };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Style format hints row
    worksheet.getRow(2).font = { italic: true, color: { argb: 'FF666666' } };
    worksheet.getRow(2).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF5F5F5' }, // Light gray
    };

    // Format Beginning Balance column (B3:B8) as numbers with 2 decimal places
    for (let row = 3; row <= 8; row++) {
      worksheet.getCell(`B${row}`).numFmt = '0.00';
    }

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsWorksheet = workbook.addWorksheet('Instructions');

    const instructionsData = [
      ['Beginning Data Import Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your beginning balance data starting from Row 3 (after the format hints)'],
      ['2. You can delete the sample data rows (3-8) or overwrite them with your actual data'],
      ['3. Add as many rows as needed for your import'],
      ['4. Make sure the Item Code exists in your Beginning Balances master data'],
      ['5. Save the file and upload it through the import function'],
      [],
      ['Column Details:'],
      [],
      ['Item Code (REQUIRED):'],
      ['  - The unique code of the item (e.g., RM-1310-001, FG-1310-001, CG-MACH-001)'],
      ['  - Must match an existing item code in the Beginning Balances master data'],
      ['  - Case sensitive'],
      [],
      ['Beginning Balance (REQUIRED):'],
      ['  - The beginning balance quantity'],
      ['  - Must be a positive number greater than 0'],
      ['  - Can include decimals (e.g., 250.5)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Beginning Date (REQUIRED):'],
      ['  - The date for this beginning balance'],
      ['  - Format: DD/MM/YYYY (e.g., 01/01/2025)'],
      ['  - Must be a valid date'],
      ['  - Cannot be in the future'],
      [],
      ['Remarks (OPTIONAL):'],
      ['  - Optional notes about the beginning balance entry'],
      ['  - Can be left empty'],
      [],
      ['Validation Rules:'],
      ['  - Item Code must exist in the Beginning Balances master data'],
      ['  - Beginning Balance must be > 0 (not just >= 0)'],
      ['  - Beginning Date cannot be in the future'],
      ['  - Beginning Date must be in DD/MM/YYYY format'],
      [],
      ['Important Notes:'],
      ['  - All fields except Remarks are REQUIRED'],
      ['  - Do NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during import'],
      ['  - Empty rows will be skipped during import'],
      ['  - If errors occur, you will receive a detailed error report with row numbers'],
      ['  - Maximum 1000 records per import'],
      [],
      ['What Happens After Import:'],
      ['  1. The system validates all entries'],
      ['  2. Creates beginning balance records'],
      ['  3. All records are inserted in a single transaction (all or nothing)'],
      ['  4. Returns a summary with total count'],
      [],
      ['Example Data:'],
      ['Item Code     | Beginning Balance | Beginning Date | Remarks'],
      ['RM-1310-001   | 100               | 01/01/2025     | Opening balance for raw materials'],
      ['FG-1310-001   | 250.5             | 01/01/2025     | Initial finished goods stock'],
      ['CG-MACH-001   | 2                 | 01/01/2025     | Capital goods - Machine'],
      ['WIP-1310-001  | 150               | 01/01/2025     | WIP stock'],
      ['SCRAP-1310-001| 10                | 01/01/2025     | Waste materials'],
      [],
      ['For assistance, please contact the system administrator.'],
    ];

    // Add instructions data
    instructionsData.forEach(row => instructionsWorksheet.addRow(row));

    // Set column width
    instructionsWorksheet.getColumn(1).width = 95;

    // Style title (Row 1)
    instructionsWorksheet.getCell('A1').font = { bold: true, size: 14 };

    // Style section headers
    const sectionHeaderRows = [3, 10, 12, 17, 22, 27, 30, 35, 42, 48];
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
    const filename = `Beginning_Data_Template_${timestamp}.xlsx`;

    // Return the file as a downloadable response
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.byteLength.toString(),
      },
    });

  } catch (error) {
    console.error('[API Error] Failed to generate beginning data template:', error);

    return NextResponse.json(
      {
        message: 'Error generating Excel template',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
