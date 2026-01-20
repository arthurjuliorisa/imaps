import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export async function exportToExcel(data: any[], fileName: string, sheetName: string = 'Sheet1') {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  if (data.length > 0) {
    // Add headers
    const headers = Object.keys(data[0]);
    worksheet.addRow(headers);

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };

    // Add data rows
    data.forEach((row) => {
      worksheet.addRow(Object.values(row));
    });

    // Auto-adjust column widths
    const maxWidth = 50;
    headers.forEach((_, index) => {
      worksheet.getColumn(index + 1).width = Math.min(maxWidth, 15);
    });
  }

  // Generate and download file
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function exportToPDF(
  data: any[],
  columns: { header: string; dataKey: string }[],
  fileName: string,
  title: string,
  subtitle?: string
) {
  const doc = new jsPDF({
    orientation: columns.length > 6 ? 'landscape' : 'portrait',
  });

  // Add title
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 15);

  // Add subtitle if provided
  if (subtitle) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitle, 14, 22);
  }

  // Add date generated
  const dateStr = new Date().toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text(`Generated: ${dateStr}`, 14, subtitle ? 28 : 22);

  // Generate table
  autoTable(doc, {
    startY: subtitle ? 32 : 26,
    head: [columns.map(col => col.header)],
    body: data.map(row => columns.map(col => row[col.dataKey] || '')),
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [30, 58, 138], // Blue color matching the theme
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250],
    },
    margin: { top: 10 },
  });

  doc.save(`${fileName}.pdf`);
}

export function formatCurrency(amount: number, currency: string = 'IDR'): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

export function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return '-';

  try {
    let date: Date;

    if (typeof dateString === 'string') {
      date = new Date(dateString);
    } else if (dateString instanceof Date) {
      date = dateString;
    } else {
      return '-';
    }

    // Check if date is valid
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return '-';
    }

    return date.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch (error) {
    console.error('Error formatting date:', error, dateString);
    return '-';
  }
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('id-ID').format(num);
}

/**
 * Export Stock Opname to Excel with proper styling
 */
export async function exportStockOpnameToExcel(
  headerInfo: { label: string; value: string }[],
  itemsData: any[],
  fileName: string
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Stock Opname');

  let currentRow = 1;

  // ============================================================================
  // HEADER INFORMATION SECTION
  // ============================================================================
  headerInfo.forEach((info) => {
    if (info.label) {
      const row = worksheet.addRow([info.label, info.value]);

      // Style for header info labels (column A)
      row.getCell(1).font = { bold: true };
      row.getCell(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' }, // Light gray
      };
      row.getCell(1).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };

      // Style for header info values (column B)
      row.getCell(2).border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };

      currentRow++;
    } else {
      // Empty row
      worksheet.addRow([]);
      currentRow++;
    }
  });

  // Add one more empty row as separator
  worksheet.addRow([]);
  currentRow++;

  // ============================================================================
  // TABLE HEADER
  // ============================================================================
  if (itemsData.length > 0) {
    const headers = Object.keys(itemsData[0]);
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 20;

    // Style each header cell individually
    headers.forEach((_, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White text
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }, // Dark blue
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    currentRow++;

    // ============================================================================
    // DATA ROWS
    // ============================================================================
    itemsData.forEach((rowData, rowIndex) => {
      const dataRow = worksheet.addRow(Object.values(rowData));

      // Alternate row colors
      if (rowIndex % 2 === 1) {
        dataRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }, // Very light gray
        };
      }

      // Add borders to all cells
      headers.forEach((_, index) => {
        const cell = dataRow.getCell(index + 1);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        // Align numbers to the right
        const value = cell.value;
        if (typeof value === 'number') {
          cell.alignment = { horizontal: 'right' };
        }
      });

      // Bold the first column (No)
      dataRow.getCell(1).font = { bold: true };

      currentRow++;
    });

    // ============================================================================
    // AUTO-ADJUST COLUMN WIDTHS
    // ============================================================================
    worksheet.columns.forEach((column, index) => {
      if (index === 0) {
        column.width = 6; // No column
      } else if (index === 1) {
        column.width = 15; // Item Code
      } else if (index === 2) {
        column.width = 30; // Item Name
      } else if (index === 3) {
        column.width = 12; // Item Type
      } else {
        column.width = 12; // Other columns
      }
    });

    // Set width for header info columns
    worksheet.getColumn(1).width = 20;
    worksheet.getColumn(2).width = 35;
  }

  // ============================================================================
  // GENERATE AND DOWNLOAD FILE
  // ============================================================================
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
}
