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

    // Define headers
    const headers = [
      'Item Type*',
      'Item Code*',
      'Item Name*',
      'UOM*',
      'Qty*',
      'Balance Date*',
      'Remarks'
    ];

    // Define format hints (row 2)
    const formatHints = [
      'e.g., ROH, FERT, HIBE_M',
      'e.g., RM-001',
      'Item description',
      'e.g., KG, PCS, LTR',
      'Positive number > 0',
      'DD/MM/YYYY',
      'Optional notes'
    ];

    // Define sample data (rows 3-7) - showcasing different item types
    const sampleData = [
      ['ROH', 'RM-001', 'Raw Material A', 'KG', 100, '01/01/2025', 'Opening balance for raw materials'],
      ['FERT', 'FG-001', 'Finished Good A', 'PCS', 250.5, '01/01/2025', 'Initial finished goods stock'],
      ['HIBE_M', 'CG-001', 'Machine A', 'UNIT', 2, '01/01/2025', 'Capital goods - Machine'],
      ['HALB', 'SFG-001', 'Semi-Finished Good A', 'KG', 150, '01/01/2025', 'WIP stock'],
      ['SCRAP', 'SC-001', 'Scrap Material A', 'KG', 10, '01/01/2025', 'Waste materials'],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 18 },  // Item Type column
      { width: 15 },  // Item Code column
      { width: 30 },  // Item Name column
      { width: 12 },  // UOM column
      { width: 15 },  // Qty column
      { width: 18 },  // Balance Date column
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

    // Format Qty column (E3:E7) as numbers with 2 decimal places
    for (let row = 3; row <= 7; row++) {
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
      ['2. You can delete the sample data rows (3-7) or overwrite them with your actual data'],
      ['3. Add as many rows as needed for your import'],
      ['4. You can import MULTIPLE item types in ONE file (ROH, FERT, HIBE_M, etc.)'],
      ['5. Save the file and upload it through the import function'],
      [],
      ['Column Details:'],
      [],
      ['Item Type* (REQUIRED):'],
      ['  - The item type code (e.g., ROH, FERT, HIBE_M)'],
      ['  - Must exist in the Item Type master data'],
      ['  - Common types: ROH (Raw Material), FERT (Finished Good), HALB (Semi-Finished),'],
      ['    HIBE (Operating Supplies), HIBE_M (Capital Goods - Machine), HIBE_E (Capital Goods - Engineering),'],
      ['    HIBE_T (Capital Goods - Tools), DIEN (Services), SCRAP (Scrap and Waste)'],
      ['  - Item types are dynamically loaded from the database, so new types are automatically supported'],
      ['  - Case sensitive'],
      [],
      ['Item Code* (REQUIRED):'],
      ['  - The unique code of the item (e.g., RM-001, FG-001)'],
      ['  - Must match the item code in your system'],
      ['  - Case sensitive'],
      [],
      ['Item Name* (REQUIRED):'],
      ['  - The name/description of the item'],
      ['  - Will be stored as provided'],
      [],
      ['UOM* (REQUIRED):'],
      ['  - Unit of Measure code (e.g., KG, PCS, LTR, UNIT)'],
      ['  - Must be a valid UOM in your system'],
      ['  - Case sensitive'],
      [],
      ['Qty* (REQUIRED):'],
      ['  - The beginning balance quantity'],
      ['  - Must be a positive number greater than 0'],
      ['  - Can include decimals (e.g., 250.5)'],
      ['  - Format: Number with up to 3 decimal places supported'],
      [],
      ['Balance Date* (REQUIRED):'],
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
      ['  - Item Code + Balance Date combination must be unique per company'],
      ['  - Item Type must exist in the Item Type master data (validated against database)'],
      ['  - Qty must be > 0 (not just >= 0)'],
      ['  - Balance Date cannot be in the future'],
      [],
      ['Multi-Type Import:'],
      ['  - You can import ALL item types in a SINGLE Excel file'],
      ['  - Simply specify the Item Type for each row'],
      ['  - The system will process all types together in one transaction'],
      ['  - After import, you will receive a summary showing counts by item type'],
      ['  - Example summary: { total: 10, byType: { ROH: 5, FERT: 3, HIBE_M: 2 } }'],
      [],
      ['Important Notes:'],
      ['  - Fields marked with * are REQUIRED'],
      ['  - Do NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during import'],
      ['  - Empty rows will be skipped during import'],
      ['  - If errors occur, you will receive a detailed error report with row numbers'],
      ['  - Maximum 1000 records per import'],
      [],
      ['What Happens After Import:'],
      ['  1. The system validates all entries (including item type validation against database)'],
      ['  2. Creates beginning balance records for all item types'],
      ['  3. All records are inserted in a single transaction (all or nothing)'],
      ['  4. Returns a summary with total count and breakdown by item type'],
      [],
      ['Example Data:'],
      ['Item Type | Item Code | Item Name           | UOM  | Qty   | Balance Date | Remarks'],
      ['ROH       | RM-001    | Raw Material A      | KG   | 100   | 01/01/2025   | Opening balance'],
      ['FERT      | FG-001    | Finished Good A     | PCS  | 250.5 | 01/01/2025   | Initial stock'],
      ['HIBE_M    | CG-001    | Machine A           | UNIT | 2     | 01/01/2025   | Capital goods'],
      ['HALB      | SFG-001   | Semi-Finished Good A| KG   | 150   | 01/01/2025   | WIP stock'],
      ['SCRAP     | SC-001    | Scrap Material A    | KG   | 10    | 01/01/2025   | Waste materials'],
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
    const sectionHeaderRows = [3, 10, 12, 21, 26, 31, 36, 41, 46, 51, 56, 62, 67, 74];
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
