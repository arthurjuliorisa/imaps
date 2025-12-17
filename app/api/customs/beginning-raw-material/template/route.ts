import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

/**
 * GET /api/customs/beginning-raw-material/template
 * Generates and downloads an Excel template file for beginning stock imports
 *
 * Returns:
 * - Excel file (.xlsx) with proper formatting and sample data
 * - Headers: Item Code, Item Name, UOM Code, Beginning Balance, Beginning Date, Remarks
 * - Includes format hints and sample data rows
 * - Contains an additional Instructions sheet
 */
export async function GET() {
  try {
    // Create a new workbook
    const workbook = new ExcelJS.Workbook();

    // ============================================
    // SHEET 1: Beginning Stock Import Template (Main Sheet)
    // ============================================

    const worksheet = workbook.addWorksheet('Beginning Stock Template');

    // Define headers
    const headers = ['Item Code*', 'Item Name', 'UOM Code*', 'Beginning Balance*', 'Beginning Date*', 'Remarks'];

    // Define format hints (row 2)
    const formatHints = ['e.g., RM-001', 'Informational only', 'e.g., KG', 'Positive number > 0', 'DD/MM/YYYY', 'Optional notes'];

    // Define sample data (rows 3-5)
    const sampleData = [
      ['RM-001', 'Raw Material A', 'KG', 100, '01/01/2025', 'Opening balance'],
      ['RM-002', 'Raw Material B', 'PCS', 250.5, '01/01/2025', 'Initial stock'],
      ['RM-003', 'Raw Material C', 'LTR', 50, '15/01/2025', 'Beginning inventory'],
    ];

    // Add rows
    worksheet.addRow(headers);
    worksheet.addRow(formatHints);
    sampleData.forEach(row => worksheet.addRow(row));

    // Set column widths
    worksheet.columns = [
      { width: 15 },  // Item Code column
      { width: 25 },  // Item Name column
      { width: 12 },  // UOM Code column
      { width: 18 },  // Beginning Balance column
      { width: 18 },  // Beginning Date column
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

    // Format Beginning Balance column (D3:D5)
    for (let row = 3; row <= 5; row++) {
      worksheet.getCell(`D${row}`).numFmt = '0.00';
    }

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsWorksheet = workbook.addWorksheet('Instructions');

    const instructionsData = [
      ['Beginning Stock (Raw Material) Import Template - Instructions'],
      [],
      ['How to Use This Template:'],
      ['1. Fill in your beginning stock data starting from Row 3 (after the format hints)'],
      ['2. You can delete the sample data rows (3-5) or overwrite them with your actual data'],
      ['3. Add as many rows as needed for your import'],
      ['4. Save the file and upload it through the import function'],
      [],
      ['Column Details:'],
      [],
      ['Item Code* (REQUIRED):'],
      ['  - The unique code of the raw material item (e.g., RM-001)'],
      ['  - Must exist in the Item master data with type "Raw Material"'],
      ['  - Case sensitive'],
      [],
      ['Item Name (INFORMATIONAL):'],
      ['  - Display name of the item for reference only'],
      ['  - This field is NOT validated and will be ignored during import'],
      ['  - The system will use the Item Code to lookup the correct item'],
      [],
      ['UOM Code* (REQUIRED):'],
      ['  - Unit of Measure code (e.g., KG, PCS, LTR)'],
      ['  - Must exist in the UOM master data'],
      ['  - Case sensitive'],
      [],
      ['Beginning Balance* (REQUIRED):'],
      ['  - The opening/starting balance quantity'],
      ['  - Must be a positive number greater than 0'],
      ['  - Can include decimals (e.g., 250.5)'],
      ['  - Format: Number with up to 2 decimal places recommended'],
      [],
      ['Beginning Date* (REQUIRED):'],
      ['  - The date for this beginning balance'],
      ['  - Format: DD/MM/YYYY (e.g., 01/01/2025)'],
      ['  - Must be a valid date'],
      ['  - Cannot be in the future'],
      [],
      ['Remarks (OPTIONAL):'],
      ['  - Optional notes about the beginning stock entry'],
      ['  - Maximum 1000 characters'],
      ['  - Can be left empty'],
      [],
      ['Validation Rules:'],
      ['  - Item Code + Beginning Date combination must be unique'],
      ['  - Item Code must exist in the system and be of type "Raw Material"'],
      ['  - UOM Code must exist in the system'],
      ['  - Beginning Balance must be > 0 (not just >= 0)'],
      ['  - Beginning Date cannot be in the future'],
      [],
      ['Important Notes:'],
      ['  - Fields marked with * are REQUIRED'],
      ['  - Do NOT modify the header row (Row 1)'],
      ['  - Format hints (Row 2) are for reference only and will be ignored during import'],
      ['  - Item Name is for reference only - the system uses Item Code for lookup'],
      ['  - The system will automatically update mutation records after import'],
      ['  - Empty rows will be skipped during import'],
      ['  - If errors occur, you will receive a detailed error report'],
      [],
      ['What Happens After Import:'],
      ['  1. The system validates all entries'],
      ['  2. Creates beginning stock records'],
      ['  3. Finds the first mutation record for each item on or after the beginning date'],
      ['  4. Updates the beginning balance of that mutation record'],
      ['  5. Recalculates all subsequent mutation records to maintain data consistency'],
      [],
      ['Example Data:'],
      ['Item Code | Item Name      | UOM Code | Beginning Balance | Beginning Date | Remarks'],
      ['RM-001    | Raw Material A | KG       | 100               | 01/01/2025     | Opening balance'],
      ['RM-002    | Raw Material B | PCS      | 250.5             | 01/01/2025     | Initial stock'],
      ['RM-003    | Raw Material C | LTR      | 50                | 15/01/2025     | Beginning inventory'],
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
    const sectionHeaderRows = [3, 9, 11, 17, 23, 29, 35, 41, 47, 54, 62];
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
    const filename = `Beginning_Stock_Raw_Material_Template_${timestamp}.xlsx`;

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
    console.error('[API Error] Failed to generate beginning stock template:', error);

    return NextResponse.json(
      {
        message: 'Error generating Excel template',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
