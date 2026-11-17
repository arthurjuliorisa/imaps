type ReportColumn = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date';
  width?: number;
  preserveBlank?: boolean;
};

/** Called by authenticated export orchestrators, never with a URL role. */
export function reportingUomColumns(columns: ReportColumn[]): ReportColumn[] {
  return columns.flatMap(column => {
    if (!['uom', 'unit', 'unitQuantity'].includes(column.key)) return [column];
    const mapped: ReportColumn = {
      key: 'inswUom', label: 'UoM CEISA/INSW', type: 'text', width: 20, preserveBlank: true,
    };
    return [column, mapped];
  });
}
