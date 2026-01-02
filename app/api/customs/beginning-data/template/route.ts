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
      'Item Type',
      'Item Code',
      'Item Name',
      'UOM',
      'Qty',
      'Balance Date',
      'PPKEK Numbers',
      'Remarks'
    ];

    // Define format hints (row 2)
    const formatHints = [
      'e.g., ROH, FERT, HALB, HIBE_M, SCRAP',
      'e.g., RM-001, FG-001',
      'Item description',
      'e.g., KG, PCS, SET',
      'Positive number > 0',
      'DD/MM/YYYY',
      'Comma-separated, e.g., 001,002,003 (optional)',
      'Optional notes'
    ];

    // Define sample data (rows 3-8) - showcasing different item types
    const sampleData = [
      ['ROH', 'RM-1310-001', 'Steel Plate', 'KG', 100, '01/01/2025', '001,002', 'Opening balance for raw materials'],
      ['FERT', 'FG-1310-001', 'Finished Product A', 'PCS', 250.5, '01/01/2025', '003', 'Initial finished goods stock'],
      ['HIBE-M', 'CG-MACH-001', 'CNC Machine', 'SET', 2, '01/01/2025', '', 'Capital goods - Machine'],
      ['HALB', 'WIP-1310-001', 'Semi-finished Product', 'PCS', 150, '01/01/2025', '004,005,006', 'WIP stock'],
      ['SCRAP', 'SCRAP-1310-001', 'Waste Materials', 'KG', 10, '01/01/2025', '', 'Waste materials'],
      ['HIBE_E', 'CG-EQUIP-001', 'Testing Equipment', 'SET', 5, '01/01/2025', '007', 'Quality control equipment'],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 15 },  // Item Type column
      { width: 18 },  // Item Code column
      { width: 25 },  // Item Name column
      { width: 10 },  // UOM column
      { width: 15 },  // Qty column
      { width: 18 },  // Balance Date column
      { width: 30 },  // PPKEK Numbers column
      { width: 35 },  // Remarks column
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

    // Format Qty column (E3:E8) as numbers with 2 decimal places
    for (let row = 3; row <= 8; row++) {
      worksheet.getCell(`E${row}`).numFmt = '0.00';
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
      ['Item Type (REQUIRED):'],
      ['  - The item type code (e.g., ROH, FERT, HALB, HIBE_M, HIBE_E, HIBE_T, SCRAP, HIBE, DIEN)'],
      ['  - Must match an existing item type code in the system'],
      ['  - Case sensitive'],
      [],
      ['Item Code (REQUIRED):'],
      ['  - The unique code of the item (e.g., RM-1310-001, FG-1310-001, CG-MACH-001)'],
      ['  - Can be any unique identifier for the item'],
      ['  - Case sensitive'],
      [],
      ['Item Name (REQUIRED):'],
      ['  - The description/name of the item (e.g., Steel Plate, Finished Product A)'],
      ['  - Cannot be empty'],
      [],
      ['UOM (REQUIRED):'],
      ['  - Unit of Measurement (e.g., KG, PCS, SET, METER)'],
      ['  - Cannot be empty'],
      [],
      ['Qty (REQUIRED):'],
      ['  - The beginning balance quantity'],
      ['  - Must be a positive number greater than 0'],
      ['  - Can include decimals (e.g., 250.5)'],
      ['  - Format: Number with up to 2 decimal places'],
      [],
      ['Balance Date (REQUIRED):'],
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
      ['  - Item Type must exist in the system'],
      ['  - All fields except Remarks are REQUIRED'],
      ['  - Qty must be > 0 (not just >= 0)'],
      ['  - Balance Date cannot be in the future'],
      ['  - Balance Date must be in DD/MM/YYYY format'],
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
      ['Item Type | Item Code    | Item Name          | UOM  | Qty   | Balance Date | Remarks'],
      ['ROH       | RM-1310-001  | Steel Plate        | KG   | 100   | 01/01/2025   | Opening balance for raw materials'],
      ['FERT      | FG-1310-001  | Finished Product A | PCS  | 250.5 | 01/01/2025   | Initial finished goods stock'],
      ['HIBE-M    | CG-MACH-001  | CNC Machine        | SET  | 2     | 01/01/2025   | Capital goods - Machine'],
      ['HALB      | WIP-1310-001 | Semi-finished      | PCS  | 150   | 01/01/2025   | WIP stock'],
      ['SCRAP     | SCRAP-001    | Waste Materials    | KG   | 10    | 01/01/2025   | Waste materials'],
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
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const filename = `Beginning_Data_Template_${year}${month}${date}.xlsx`;

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
