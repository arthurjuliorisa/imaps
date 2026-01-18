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
        { message: 'Invalid stock opname ID' },
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
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    // Check if status allows editing
    if (stockOpname.status === 'RELEASED') {
      return NextResponse.json(
        { message: 'Cannot add items to released stock opname' },
        { status: 400 }
      );
    }

    // Parse Excel file
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { message: 'No file uploaded' },
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
        { message: 'Excel file is empty' },
        { status: 400 }
      );
    }

    // Validate each row
    const validatedRows = [];

    for (let i = 0; i < data.length; i++) {
      const row: any = data[i];
      const rowNumber = i + 2; // Excel row number (header is row 1)

      const validatedRow: any = {
        row: rowNumber,
        item_code: row.item_code || row['Item Code'] || '',
        sto_qty: parseFloat(row.sto_qty || row['STO Qty'] || '0'),
        report_area: row.report_area || row['Report Area'] || null,
        sto_pic_name: row.sto_pic_name || row['PIC Name'] || null,
        remark: row.remark || row['Remark'] || null,
        isValid: true,
        errorMessage: null,
      };

      // Validate required fields
      if (!validatedRow.item_code) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Item code is required';
      } else if (isNaN(validatedRow.sto_qty) || validatedRow.sto_qty < 0) {
        validatedRow.isValid = false;
        validatedRow.errorMessage = 'Invalid STO quantity';
      } else {
        // Check if item exists in master data
        const item = await prisma.lpj_mutasi_items.findFirst({
          where: {
            company_code: companyCode,
            item_code: validatedRow.item_code,
          },
          select: {
            item_code: true,
            item_name: true,
            item_type_code: true,
          },
        });

        if (!item) {
          validatedRow.isValid = false;
          validatedRow.errorMessage = 'Item code not found in master data';
        } else {
          // Check if item already exists in this stock opname
          const existingItem = await prisma.stock_opname_items.findFirst({
            where: {
              stock_opname_id: stockOpnameId,
              item_code: validatedRow.item_code,
              deleted_at: null,
            },
          });

          if (existingItem) {
            validatedRow.isValid = false;
            validatedRow.errorMessage = 'Item already exists in this stock opname';
          }
        }
      }

      validatedRows.push(validatedRow);
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
      { message: 'Error validating file' },
      { status: 500 }
    );
  }
}
