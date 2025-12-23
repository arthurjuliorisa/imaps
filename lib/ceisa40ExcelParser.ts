import * as XLSX from 'xlsx';

/**
 * Interface for parsed Ceisa 4.0 Excel data
 */
export interface ParsedCeisaItem {
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  valueAmount: number;
}

export interface ParsedCeisaData {
  companyName: string;
  docType: string;
  ppkekNumber: string;
  regDate: string;
  docNumber: string;
  docDate: string;
  recipientName: string;
  itemType: string;
  currency: string;
  items: ParsedCeisaItem[];
}

/**
 * Parse a Ceisa 4.0 Excel file
 * @param buffer - The Excel file buffer
 * @returns Parsed data from the Excel file
 */
export async function parseCeisa40Excel(buffer: Buffer): Promise<ParsedCeisaData> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Extract data from different sheets
    const headerSheet = workbook.Sheets['HEADER'];
    const dokumenSheet = workbook.Sheets['DOKUMEN'];
    const entitasSheet = workbook.Sheets['ENTITAS'];
    const barangSheet = workbook.Sheets['BARANG'];

    if (!headerSheet || !dokumenSheet || !entitasSheet || !barangSheet) {
      throw new Error('Required sheets (HEADER, DOKUMEN, ENTITAS, BARANG) not found in Excel file');
    }

    // Parse HEADER sheet (row-based: row 1 = headers, row 2 = values)
    const headerData = XLSX.utils.sheet_to_json(headerSheet, { header: 1 }) as any[][];
    if (headerData.length < 2) {
      throw new Error('HEADER sheet must have at least 2 rows (header and data)');
    }

    const headerRow = headerData[0];
    const valueRow = headerData[1];

    // Find column indices dynamically
    const docTypeIndex = headerRow.indexOf('KODE DOKUMEN');
    const ppkekNumberIndex = headerRow.indexOf('NOMOR DAFTAR');
    const regDateIndex = headerRow.indexOf('TANGGAL DAFTAR');
    const currencyIndex = headerRow.indexOf('KODE VALUTA');

    const docType = docTypeIndex >= 0 ? String(valueRow[docTypeIndex] || '') : '';
    const ppkekNumber = ppkekNumberIndex >= 0 ? String(valueRow[ppkekNumberIndex] || '') : '';
    const regDate = regDateIndex >= 0 ? parseExcelDate(valueRow[regDateIndex]) : '';
    const currency = currencyIndex >= 0 ? String(valueRow[currencyIndex] || 'USD') : 'USD';

    // Company Name: Try to get from ENTITAS sheet (code 8 or first entity)
    // Item Type: Will be determined from the context (default to SCRAP for scrap transactions)
    let companyName = '';
    const itemType = 'SCRAP'; // Default, can be overridden by user

    // Parse ENTITAS sheet - get company name and recipient
    const entitasData = XLSX.utils.sheet_to_json(entitasSheet, { header: 1 }) as any[][];
    let recipientName = '';

    // Find header row
    const entitasHeaderIndex = entitasData.findIndex(row =>
      row.some((cell: any) =>
        typeof cell === 'string' && cell.includes('NAMA ENTITAS')
      )
    );

    if (entitasHeaderIndex >= 0 && entitasData.length > entitasHeaderIndex + 1) {
      const entitasHeader = entitasData[entitasHeaderIndex];
      const nameColumnIndex = entitasHeader.findIndex((cell: any) =>
        typeof cell === 'string' && cell.includes('NAMA ENTITAS')
      );
      const codeColumnIndex = entitasHeader.findIndex((cell: any) =>
        typeof cell === 'string' && cell.includes('KODE ENTITAS')
      );

      // Get first entity as company name (usually the importer/owner)
      if (entitasData.length > entitasHeaderIndex + 1 && nameColumnIndex >= 0) {
        companyName = String(entitasData[entitasHeaderIndex + 1][nameColumnIndex] || '');
      }

      // Find entity with code 8 (recipient/shipper)
      for (let i = entitasHeaderIndex + 1; i < entitasData.length; i++) {
        const row = entitasData[i];
        if (codeColumnIndex >= 0 && nameColumnIndex >= 0) {
          const code = String(row[codeColumnIndex] || '');
          if (code === '8') {
            recipientName = String(row[nameColumnIndex] || '');
            break;
          }
        }
      }
    }

    // If no recipient found, use first entity
    if (!recipientName && companyName) {
      recipientName = companyName;
    }

    // Parse DOKUMEN sheet - find document number and date
    const dokumenData = XLSX.utils.sheet_to_json(dokumenSheet, { header: 1 }) as any[][];
    let docNumber = '';
    let docDate = '';

    // Find header row in DOKUMEN
    const dokumenHeaderIndex = dokumenData.findIndex(row =>
      row.some((cell: any) =>
        typeof cell === 'string' && (cell.includes('NOMOR DOKUMEN') || cell.includes('KODE DOKUMEN'))
      )
    );

    if (dokumenHeaderIndex >= 0 && dokumenData.length > dokumenHeaderIndex + 1) {
      const dokumenHeader = dokumenData[dokumenHeaderIndex];
      const docNumberIndex = dokumenHeader.findIndex((cell: any) =>
        typeof cell === 'string' && cell.includes('NOMOR DOKUMEN')
      );
      const docDateIndex = dokumenHeader.findIndex((cell: any) =>
        typeof cell === 'string' && cell.includes('TANGGAL DOKUMEN')
      );
      const docCodeIndex = dokumenHeader.findIndex((cell: any) =>
        typeof cell === 'string' && cell.includes('KODE DOKUMEN')
      );

      // Try to find row with code 308 (invoice), or use first document
      let targetRow = null;
      for (let i = dokumenHeaderIndex + 1; i < dokumenData.length; i++) {
        const row = dokumenData[i];
        if (docCodeIndex >= 0 && (row[docCodeIndex] === '308' || row[docCodeIndex] === 308)) {
          targetRow = row;
          break;
        }
      }

      // If no 308 found, use first document row
      if (!targetRow && dokumenData.length > dokumenHeaderIndex + 1) {
        targetRow = dokumenData[dokumenHeaderIndex + 1];
      }

      if (targetRow) {
        if (docNumberIndex >= 0) {
          docNumber = String(targetRow[docNumberIndex] || '');
        }
        if (docDateIndex >= 0) {
          docDate = parseExcelDate(targetRow[docDateIndex]);
        }
      }
    }

    // Parse BARANG sheet - get all items
    const barangData = XLSX.utils.sheet_to_json(barangSheet, { header: 1 }) as any[][];
    const items: ParsedCeisaItem[] = [];

    // Find header row
    const barangHeaderIndex = barangData.findIndex(row =>
      row.some((cell: any) =>
        typeof cell === 'string' && (cell.includes('KODE BARANG') || cell.includes('URAIAN'))
      )
    );

    if (barangHeaderIndex === -1) {
      throw new Error('Header row not found in BARANG sheet');
    }

    const barangHeader = barangData[barangHeaderIndex];
    const itemCodeIndex = barangHeader.findIndex((cell: any) =>
      typeof cell === 'string' && cell.includes('KODE BARANG')
    );
    const itemNameIndex = barangHeader.findIndex((cell: any) =>
      typeof cell === 'string' && cell.includes('URAIAN')
    );
    const unitIndex = barangHeader.findIndex((cell: any) =>
      typeof cell === 'string' && cell.includes('KODE SATUAN')
    );
    const quantityIndex = barangHeader.findIndex((cell: any) =>
      typeof cell === 'string' && cell.includes('JUMLAH SATUAN')
    );
    const valueAmountIndex = barangHeader.findIndex((cell: any) =>
      typeof cell === 'string' && (cell.includes('CIF') || cell.includes('NILAI'))
    );

    // Parse items starting from the row after header
    for (let i = barangHeaderIndex + 1; i < barangData.length; i++) {
      const row = barangData[i];

      // Skip empty rows
      if (!row || row.length === 0) {
        continue;
      }

      const itemCode = itemCodeIndex >= 0 ? String(row[itemCodeIndex] || '') : '';
      const itemName = itemNameIndex >= 0 ? String(row[itemNameIndex] || '') : '';
      const unit = unitIndex >= 0 ? String(row[unitIndex] || '') : '';
      const quantity = quantityIndex >= 0 ? parseFloat(String(row[quantityIndex] || '0')) : 0;
      const valueAmount = valueAmountIndex >= 0 ? parseFloat(String(row[valueAmountIndex] || '0')) : 0;

      // Only add items that have at least a code and name
      if (itemCode && itemName) {
        items.push({
          itemCode,
          itemName,
          unit: unit || 'PCE', // Default unit
          quantity: isNaN(quantity) ? 0 : quantity,
          valueAmount: isNaN(valueAmount) ? 0 : valueAmount,
        });
      }
    }

    if (items.length === 0) {
      throw new Error('No items found in BARANG sheet');
    }

    return {
      companyName,
      docType,
      ppkekNumber,
      regDate,
      docNumber,
      docDate,
      recipientName,
      itemType,
      currency,
      items,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse Ceisa 4.0 Excel file: ${error.message}`);
    }
    throw new Error('Failed to parse Ceisa 4.0 Excel file: Unknown error');
  }
}

/**
 * Get cell value by column letter and row number
 */
function getCellValue(sheet: XLSX.WorkSheet, col: string, row: number): string {
  const cellAddress = `${col}${row}`;
  const cell = sheet[cellAddress];
  return cell ? String(cell.v || '') : '';
}

/**
 * Find a value in the sheet by searching for a label
 */
function findValueByLabel(sheet: XLSX.WorkSheet, label: string): string {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[cellAddress];

      if (cell && typeof cell.v === 'string' && cell.v.includes(label)) {
        // Found the label, try to get the value from adjacent cells
        // Try next column (right)
        const nextCellAddress = XLSX.utils.encode_cell({ r: R, c: C + 1 });
        const nextCell = sheet[nextCellAddress];
        if (nextCell && nextCell.v) {
          return String(nextCell.v);
        }

        // Try next row (below)
        const belowCellAddress = XLSX.utils.encode_cell({ r: R + 1, c: C });
        const belowCell = sheet[belowCellAddress];
        if (belowCell && belowCell.v) {
          return String(belowCell.v);
        }
      }
    }
  }

  return '';
}

/**
 * Parse Excel date (handles both date objects and serial numbers)
 */
function parseExcelDate(value: any): string {
  if (!value) return '';

  // If it's already a string in date format, return it
  if (typeof value === 'string') {
    return value;
  }

  // If it's a number (Excel serial date)
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const year = date.y;
      const month = String(date.m).padStart(2, '0');
      const day = String(date.d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // If it's a Date object
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  return String(value);
}

/**
 * Validate the parsed data
 */
export function validateParsedData(data: ParsedCeisaData): string[] {
  const errors: string[] = [];

  if (!data.companyName) {
    errors.push('Company Name is required');
  }

  if (!data.docType) {
    errors.push('Document Type is required');
  }

  if (!data.ppkekNumber) {
    errors.push('PPKEK Number is required');
  }

  if (!data.regDate) {
    errors.push('Registration Date is required');
  }

  if (!data.docNumber) {
    errors.push('Document Number is required');
  }

  if (!data.docDate) {
    errors.push('Document Date is required');
  }

  if (!data.itemType) {
    errors.push('Item Type is required');
  }

  if (!data.items || data.items.length === 0) {
    errors.push('At least one item is required');
  }

  data.items.forEach((item, index) => {
    if (!item.itemCode) {
      errors.push(`Item ${index + 1}: Item Code is required`);
    }
    if (!item.itemName) {
      errors.push(`Item ${index + 1}: Item Name is required`);
    }
    if (!item.unit) {
      errors.push(`Item ${index + 1}: Unit is required`);
    }
    if (item.quantity <= 0) {
      errors.push(`Item ${index + 1}: Quantity must be greater than 0`);
    }
  });

  return errors;
}
