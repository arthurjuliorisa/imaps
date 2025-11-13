import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

/**
 * GET /api/customs/beginning-finish-good/template
 * Generates and downloads an Excel template file for beginning stock imports (Capital Goods)
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
    const workbook = XLSX.utils.book_new();

    // ============================================
    // SHEET 1: Beginning Stock Import Template (Main Sheet)
    // ============================================

    // Define headers
    const headers = ['Item Code*', 'Item Name', 'UOM Code*', 'Beginning Balance*', 'Beginning Date*', 'Remarks'];

    // Define format hints (row 2)
    const formatHints = ['e.g., CG-001', 'Informational only', 'e.g., KG', 'Positive number > 0', 'DD/MM/YYYY', 'Optional notes'];

    // Define sample data (rows 3-5)
    const sampleData = [
      ['CG-001', 'Capital Good A', 'KG', 100, '01/01/2025', 'Opening balance'],
      ['CG-002', 'Capital Good B', 'PCS', 250.5, '01/01/2025', 'Initial stock'],
      ['CG-003', 'Capital Good C', 'BOX', 50, '15/01/2025', 'Beginning inventory'],
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
      { wch: 15 },  // Item Code column
      { wch: 25 },  // Item Name column
      { wch: 12 },  // UOM Code column
      { wch: 18 },  // Beginning Balance column
      { wch: 18 },  // Beginning Date column
      { wch: 30 },  // Remarks column
    ];

    // Apply styling to headers (Row 1)
    const headerCellAddresses = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'];
    headerCellAddresses.forEach(address => {
      if (!worksheet[address]) return;

      worksheet[address].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'ADD8E6' } }, // Light blue background
        alignment: { horizontal: 'center', vertical: 'center' },
      };
    });

    // Set number format for Beginning Balance column (D3:D5)
    for (let row = 3; row <= 5; row++) {
      const cellAddress = `D${row}`;
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].z = '0.00';
      }
    }

    // Append the main worksheet to the workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Beginning Stock Template');

    // ============================================
    // SHEET 2: Instructions
    // ============================================

    const instructionsData = [
      ['Beginning Stock (Capital Good) Import Template - Instructions'],
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
      ['  - The unique code of the Capital Good item (e.g., CG-001)'],
      ['  - Must exist in the Item master data with type "Capital Good"'],
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
      ['  - Item Code must exist in the system and be of type "Capital Good"'],
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
      ['Item Code | Item Name       | UOM Code | Beginning Balance | Beginning Date | Remarks'],
      ['CG-001    | Capital Good A | KG       | 100               | 01/01/2025     | Opening balance'],
      ['CG-002    | Capital Good B | PCS      | 250.5             | 01/01/2025     | Initial stock'],
      ['CG-003    | Capital Good C | BOX      | 50                | 15/01/2025     | Beginning inventory'],
      [],
      ['For assistance, please contact the system administrator.'],
    ];

    // Create instructions worksheet
    const instructionsWorksheet = XLSX.utils.aoa_to_sheet(instructionsData);

    // Set column width for instructions sheet
    instructionsWorksheet['!cols'] = [
      { wch: 90 },  // Wide column for instructions
    ];

    // Make the title bold (Row 1)
    if (instructionsWorksheet['A1']) {
      instructionsWorksheet['A1'].s = {
        font: { bold: true, sz: 14 },
        alignment: { horizontal: 'left' },
      };
    }

    // Make section headers bold
    const sectionHeaderRows = ['A3', 'A9', 'A11', 'A17', 'A23', 'A29', 'A35', 'A41', 'A47', 'A54', 'A62'];
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
      cellStyles: true,
    });

    // Create filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Beginning_Stock_Capital_Goods_Template_${timestamp}.xlsx`;

    // Return the file as a downloadable response
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': buffer.length.toString(),
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
