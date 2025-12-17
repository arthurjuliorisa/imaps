export interface MaterialUsageHeaderData {
  transaction_date: Date;
  work_order_number?: string;
  cost_center_number?: string;
  internal_evidence_number: string;
  reversal?: string;
}

export interface MaterialUsageItem {
  id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  qty: number;
  ppkek_number?: string;
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
