import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

/**
 * GET /api/customs/stock-opname/template
 * Generates and downloads an Excel template file for stock opname bulk upload
 *
 * Returns:
 * - Excel file (.xlsx) with proper formatting and sample data
 * - Headers: Item Code, STO Qty, Report Area, Remark
 * - Includes format hints and sample data rows
 * - Contains an additional Instructions sheet
 */
export async function GET() {
  try {
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // ============================================
    // SHEET 1: Stock Opname Upload Template (Main Sheet)
    // ============================================

    const worksheet = workbook.addWorksheet('Stock Opname Items');

    // Define headers
    const headers = ['Item Code', 'STO Qty', 'Report Area', 'Remark'];

    // Define format hints (row 2)
    const formatHints = ['e.g., ROH-001', 'Physical count quantity', 'Location/area', 'Optional notes'];

    // Define sample data (rows 3-5)
    const sampleData = [
      ['ROH-001', 100, 'Warehouse A', 'Main storage'],
      ['HALB-002', 50.5, 'Production Floor', 'Near assembly line'],
      ['FERT-003', 200, 'Warehouse B', ''],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 20 },  // Item Code column
      { width: 15 },  // STO Qty column
      { width: 25 },  // Report Area column
      { width: 40 },  // Remark column
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFADD8E6' },
    };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Format STO Qty column (B3:B5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`B${row}`).numFmt = '0.000';
    }

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsWorksheet = workbook.addWorksheet('Instructions');

    const instructionsData = [
      ['Stock Opname Upload Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your stock opname data starting from Row 3 (after the format hints)'],
      ['2. You can delete the sample data rows (3-5) or overwrite them with your actual data'],
      ['3. Add as many rows as needed for your stock opname items'],
      ['4. Save the file and upload it through the stock opname form'],
      [],
      ['Column Details:'],
      [],
      ['Item Code:'],
      ['  - The unique code of the item being counted (e.g., ROH-001, HALB-002, FERT-003)'],
      ['  - Required field'],
      ['  - Must exist in the items master data'],
      ['  - Must be active and belong to your company'],
      ['  - Case sensitive'],
      ['  - Cannot have duplicate item codes in the same upload'],
      [],
      ['STO Qty:'],
      ['  - The physical count quantity (Stock Taking Opname Quantity)'],
      ['  - Required field'],
      ['  - Must be a non-negative number (can include decimals up to 3 places)'],
      ['  - Format: Number (e.g., 100, 50.5, 200.125)'],
      ['  - This is the actual quantity you counted physically'],
      [],
      ['Report Area:'],
      ['  - Location or area where the item was counted'],
      ['  - Optional field'],
      ['  - Maximum 100 characters'],
      ['  - Examples: "Warehouse A", "Production Floor", "Storage Room 2"'],
      [],
      ['Remark:'],
      ['  - Optional notes or comments about the item count'],
      ['  - Maximum 1000 characters'],
      ['  - Can be left empty'],
      ['  - Examples: "Found in damaged condition", "Near expiry"'],
      [],
      ['Validation Rules:'],
      ['  - All Item Codes must exist in the system and be active'],
      ['  - STO Qty must be >= 0'],
      ['  - Cannot have duplicate item codes in the same upload'],
      ['  - Item must belong to your company'],
      [],
      ['Important Notes:'],
      ['  - DO NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during upload'],
      ['  - Empty rows will be skipped during upload'],
      ['  - The system will automatically:'],
      ['    * Retrieve item name, type, and UOM from items master'],
      ['    * Calculate end stock based on LPJ mutasi up to stock opname datetime'],
      ['    * Calculate variance (STO Qty - End Stock)'],
      ['  - If an error occurs during upload, the entire upload will be rolled back'],
      ['  - After uploading items, the stock opname status will change to PROCESS'],
      [],
      ['Example Data:'],
      ['Item Code | STO Qty | Report Area         | Remark'],
      ['ROH-001   | 100     | Warehouse A         | Main storage'],
      ['HALB-002  | 50.5    | Production Floor    | Near assembly line'],
      ['FERT-003  | 200     | Warehouse B         | '],
      [],
      ['For assistance, please contact the system administrator.'],
    ];

    // Add instructions data
    instructionsData.forEach(row => instructionsWorksheet.addRow(row));

    // Set column width
    instructionsWorksheet.getColumn(1).width = 90;

    // Style title (Row 1)
    instructionsWorksheet.getCell('A1').font = { bold: true, size: 14 };

    // Style section headers
    const sectionHeaderRows = [3, 9, 11, 19, 27, 34, 39, 45];
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
    const filename = `Stock_Opname_Upload_Template_${timestamp}.xlsx`;

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
    console.error('[API Error] Failed to generate stock opname upload template:', error);

    return NextResponse.json(
      {
        message: 'Error generating Excel template',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
