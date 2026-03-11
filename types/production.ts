export interface ProductionOutputHeaderData {
  transaction_date: Date;
  internal_evidence_number: string;
  reversal?: string;
}

export interface ProductionOutputItem {
  id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  uom: string;
  qty: number;
  work_order_number: string;
  planned_production_qty: number;
  identify_product: 'Y' | 'N';
}

export interface ProductionOutputFormData {
  header: ProductionOutputHeaderData;
  items: ProductionOutputItem[];
}

export interface WorkOrderLink {
  workOrderNumber: string;
  productCode: string;
  productName: string;
  allocatedQuantity: number;
}
