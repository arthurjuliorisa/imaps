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

export function formatDate(dateString: string | Date): string {
  if (!dateString) return '';
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  return date.toLocaleDateString('id-ID', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('id-ID').format(num);
}
