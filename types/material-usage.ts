export interface MaterialUsageHeaderData {
  transaction_date: Date;
  work_order_number?: string;
  cost_center_number?: string;
  internal_evidence_number: string;
  reversal?: string;
}

/**
 * Traceability entry containing PPKEK and quantity (NEW in v3.5.0)
 */
export interface TraceabilityEntry {
  ppkek_number?: string | null;
  qty: number;
}

export interface MaterialUsageItem {
  id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  component_demand_qty?: number | null;
  amount?: number | null;
  traceability_data: TraceabilityEntry[];
}

export interface MaterialUsageFormData {
  header: MaterialUsageHeaderData;
  items: MaterialUsageItem[];
}

export interface WorkOrder {
  id: string;
  workOrderNumber: string;
  productCode: string;
  productName: string;
  targetQuantity: number;
  status: string;
}
