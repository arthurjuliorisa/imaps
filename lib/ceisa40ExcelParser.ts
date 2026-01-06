import ExcelJS from 'exceljs';

/**
 * Interface for parsed Ceisa 4.0 Excel data
 */
export interface ParsedCeisaItem {
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  valueAmount: number;
  incomingPpkekNumbers?: string[];
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
 * Parse a Ceisa 4.0 Excel file using ExcelJS
 * @param buffer - The Excel file buffer
 * @returns Parsed data from the Excel file
 */
export async function parseCeisa40Excel(buffer: Buffer): Promise<ParsedCeisaData> {
  try {
    const workbook = new ExcelJS.Workbook();
    // Load Excel file from buffer
    await workbook.xlsx.load(buffer as any);

    // Extract data from different sheets
    const headerSheet = workbook.getWorksheet('HEADER');
    const dokumenSheet = workbook.getWorksheet('DOKUMEN');
    const entitasSheet = workbook.getWorksheet('ENTITAS');
    const barangSheet = workbook.getWorksheet('BARANG');
    const bahanBakuSheet = workbook.getWorksheet('BAHANBAKU');

    if (!headerSheet || !dokumenSheet || !entitasSheet || !barangSheet) {
      throw new Error('Required sheets (HEADER, DOKUMEN, ENTITAS, BARANG) not found in Excel file');
    }

    // Parse HEADER sheet (row-based: row 1 = headers, row 2 = values)
    const headerData = worksheetToArray(headerSheet);
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
    const entitasData = worksheetToArray(entitasSheet);
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
    const dokumenData = worksheetToArray(dokumenSheet);
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

      // Try to find row with code 380 (shipping document), or use first document
      let targetRow = null;
      for (let i = dokumenHeaderIndex + 1; i < dokumenData.length; i++) {
        const row = dokumenData[i];
        if (docCodeIndex >= 0 && (row[docCodeIndex] === '380' || row[docCodeIndex] === 380)) {
          targetRow = row;
          break;
        }
      }

      // If no 380 found, use first document row
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
    const barangData = worksheetToArray(barangSheet);
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

    // Parse BAHANBAKU sheet for incoming PPKEK numbers (optional)
    if (bahanBakuSheet) {
      try {
        const bahanBakuData = worksheetToArray(bahanBakuSheet);

        // Find header row containing "NOMOR DAFTAR ASAL"
        const bahanBakuHeaderIndex = bahanBakuData.findIndex(row =>
          row.some((cell: any) =>
            typeof cell === 'string' && cell.includes('NOMOR DAFTAR ASAL')
          )
        );

        if (bahanBakuHeaderIndex >= 0) {
          const bahanBakuHeader = bahanBakuData[bahanBakuHeaderIndex];

          // Find column R (NOMOR DAFTAR ASAL) - usually column 18 (index 17)
          const nomorDaftarAsalIndex = bahanBakuHeader.findIndex((cell: any) =>
            typeof cell === 'string' && cell.includes('NOMOR DAFTAR ASAL')
          );

          // Also find KODE BARANG column to match with items
          const kodeBarangIndex = bahanBakuHeader.findIndex((cell: any) =>
            typeof cell === 'string' && cell.includes('KODE BARANG')
          );

          if (nomorDaftarAsalIndex >= 0 && kodeBarangIndex >= 0) {
            // Parse each row and match with items by item code
            for (let i = bahanBakuHeaderIndex + 1; i < bahanBakuData.length; i++) {
              const row = bahanBakuData[i];

              if (!row || row.length === 0) {
                continue;
              }

              const kodeBarang = kodeBarangIndex >= 0 ? String(row[kodeBarangIndex] || '').trim() : '';
              const nomorDaftarAsal = nomorDaftarAsalIndex >= 0 ? String(row[nomorDaftarAsalIndex] || '').trim() : '';

              // Match with items and add incoming PPKEK number
              if (kodeBarang && nomorDaftarAsal) {
                const matchingItem = items.find(item => item.itemCode === kodeBarang);
                if (matchingItem) {
                  if (!matchingItem.incomingPpkekNumbers) {
                    matchingItem.incomingPpkekNumbers = [];
                  }
                  // Split by comma or semicolon in case multiple numbers are in one cell
                  const numbers = nomorDaftarAsal.split(/[,;]/).map(n => n.trim()).filter(n => n);
                  matchingItem.incomingPpkekNumbers.push(...numbers);
                }
              }
            }
          }
        }
      } catch (bahanBakuError) {
        // Log warning but don't fail the import if BAHANBAKU parsing fails
        console.warn('[Parser] Failed to parse BAHANBAKU sheet:', bahanBakuError);
      }
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
 * Convert ExcelJS worksheet to 2D array
 */
function worksheetToArray(worksheet: ExcelJS.Worksheet): any[][] {
  const result: any[][] = [];

  worksheet.eachRow((row, rowNumber) => {
    const rowData: any[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rowData.push(cell.value);
    });
    result.push(rowData);
  });

  return result;
}

/**
 * Parse Excel date (handles both date objects and serial numbers)
 */
function parseExcelDate(value: any): string {
  if (!value) return '';

  // If it's already a string in date format, return it
  if (typeof value === 'string') {
    const trimmed = value.trim();
    
    // Check if it's already YYYY-MM-DD format
    const isoMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
      const year = isoMatch[1];
      const month = isoMatch[2].padStart(2, '0');
      const day = isoMatch[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    
    // Try to parse DD/MM/YYYY or DD-MM-YYYY formats
    const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (slashMatch) {
      const day = slashMatch[1];
      const month = slashMatch[2];
      const year = slashMatch[3];
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    
    return trimmed;
  }

  // If it's a Date object (ExcelJS automatically converts Excel dates to Date objects)
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // If it's a number (fallback for serial dates that weren't converted)
  if (typeof value === 'number') {
    // Excel serial date starts from 1900-01-01
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
