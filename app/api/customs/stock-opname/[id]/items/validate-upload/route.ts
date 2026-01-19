import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import * as XLSX from 'xlsx';

/**
 * POST /api/customs/stock-opname/[id]/items/validate-upload
 * Validate Excel file and return rows with validation status
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const stockOpnameId = parseInt(id);

    if (isNaN(stockOpnameId)) {
      return NextResponse.json(
        { message: 'ID stock opname tidak valid' },
        { status: 400 }
      );
    }

    // Check stock opname exists and belongs to company
    const stockOpname = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!stockOpname) {
      return NextResponse.json(
        { message: 'Stock opname tidak ditemukan' },
        { status: 404 }
      );
    }

    // Check if status allows editing
    if (stockOpname.status === 'RELEASED') {
      return NextResponse.json(
        { message: 'Tidak dapat menambah item ke stock opname yang sudah dirilis' },
        { status: 400 }
      );
    }

    // Parse Excel file
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { message: 'Tidak ada file yang diunggah' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (!data || data.length === 0) {
      return NextResponse.json(
        { message: 'File Excel kosong atau tidak memiliki data' },
        { status: 400 }
      );
    }

    // Validate each row
    const validatedRows = [];
    const itemCodesSeen = new Set<string>();

    // First pass: Basic validation and collect item codes
    for (let i = 0; i < data.length; i++) {
      const row: any = data[i];
      const rowNumber = i + 2; // Excel row number (header is row 1)

      const itemCode = (row.item_code || row['Item Code'] || '').toString().trim();
      const stoQtyRaw = row.sto_qty || row['STO Qty'] || '0';
      const stoQty = parseFloat(stoQtyRaw);
      const reportArea = (row.report_area || row['Report Area'] || '').toString().trim();
      const remark = (row.remark || row['Remark'] || '').toString().trim();

      const validatedRow: any = {
        row: rowNumber,
        item_code: itemCode,
        sto_qty: isNaN(stoQty) ? 0 : stoQty,
        report_area: reportArea || null,
        remark: remark || null,
        isValid: true,
        errorMessage: null,
      };

      // Skip completely empty rows
      if (!itemCode && stoQty === 0 && !reportArea && !remark) {
        continue;
      }

      // Validate required fields
      if (!itemCode) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Kode item wajib diisi';
      } else if (isNaN(stoQty)) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Jumlah STO harus berupa angka';
      } else if (stoQty < 0) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Jumlah STO tidak boleh negatif';
      } else if (reportArea && reportArea.length > 100) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Area laporan maksimal 100 karakter';
      } else if (remark && remark.length > 1000) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Keterangan maksimal 1000 karakter';
      } else {
        // Check for duplicate within the Excel file
        if (itemCodesSeen.has(itemCode)) {
          validatedRow.isValid = false;
          validatedRow.errorMessage = 'Kode item duplikat dalam file Excel';
        } else {
          itemCodesSeen.add(itemCode);
        }
      }

      validatedRows.push(validatedRow);
    }

    if (validatedRows.length === 0) {
      return NextResponse.json(
        { message: 'File Excel tidak memiliki data yang valid' },
        { status: 400 }
      );
    }

    // Limit batch size
    if (validatedRows.length > 500) {
      return NextResponse.json(
        { message: 'Jumlah data melebihi batas maksimal 500 baris' },
        { status: 400 }
      );
    }

    // Get all valid item codes for batch validation
    const validItemCodes = validatedRows
      .filter(row => row.isValid && row.item_code)
      .map(row => row.item_code);

    if (validItemCodes.length === 0) {
      return NextResponse.json({
        rows: validatedRows,
        total: validatedRows.length,
        valid: 0,
        invalid: validatedRows.length,
      });
    }

    // Batch check: Verify all items exist in master data
    const itemsFromMaster = await prisma.items.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: validItemCodes },
        deleted_at: null,
        is_active: true,
      },
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
      },
    });

    const validItemCodesSet = new Set(itemsFromMaster.map(item => item.item_code));

    // Batch check: Get items that already exist in this stock opname
    const existingItems = await prisma.stock_opname_items.findMany({
      where: {
        stock_opname_id: stockOpnameId,
        item_code: { in: validItemCodes },
        deleted_at: null,
      },
      select: {
        item_code: true,
      },
    });

    const existingItemCodesSet = new Set(existingItems.map(item => item.item_code));

    // Second pass: Validate against database
    for (const validatedRow of validatedRows) {
      if (!validatedRow.isValid) continue;

      const itemCode = validatedRow.item_code;

      if (!validItemCodesSet.has(itemCode)) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Kode item tidak ditemukan atau tidak aktif';
      } else if (existingItemCodesSet.has(itemCode)) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Item sudah ada dalam stock opname ini';
      }
    }

    return NextResponse.json({
      rows: validatedRows,
      total: validatedRows.length,
      valid: validatedRows.filter(r => r.isValid).length,
      invalid: validatedRows.filter(r => !r.isValid).length,
    });
  } catch (error) {
    console.error('[API Error] Failed to validate upload:', error);
    return NextResponse.json(
      { message: 'Terjadi kesalahan saat memvalidasi file' },
      { status: 500 }
    );
  }
}
