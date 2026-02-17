/**
 * TypeScript interfaces matching API Contract v2.4
 */

export type CustomsDocumentType = 
  | 'BC23'        // Import Declaration (Incoming)
  | 'BC27'        // Other Bonded Zone Release (Incoming & Outgoing)
  | 'BC40'        // Local Purchase from Non-Bonded Zone (Incoming)
  | 'BC30'        // Export Declaration (Outgoing)
  | 'BC25'        // Local Sales to Non-Bonded Zone (Outgoing)
  | 'BC41'        // Local Sales from Local Purchase (Outgoing) - NEW
  | 'BC261'       // Subcontracting - Incoming
  | 'BC262'       // Subcontracting - Outgoing
  | 'PPKEKTLDDP'  // PPKEK for TLDDP Program - NEW
  | 'PPKEKLDIN'   // PPKEK LDP Incoming - NEW
  | 'PPKEKLDPOUT'; // PPKEK LDP Outgoing - NEW
export type Currency = 'USD' | 'IDR' | 'CNY' | 'EUR' | 'JPY';
export type AdjustmentType = 'GAIN' | 'LOSS';

/**
 * Work Order Allocation (API Contract v3.3.0)
 * Represents how much FG quantity comes from each work order or PPKEK incoming
 */
export interface WorkOrderAllocation {
  work_order_number?: string | null;  // For production FERT/HALB (from Production Output)
  ppkek_number?: string | null;       // For incoming HALB (from Incoming Goods)
  qty: number;                        // Allocation quantity from this work order/PPKEK
  // Note: Either work_order_number OR ppkek_number required (XOR logic)
}

/**
 * Incoming Goods Request (API Contract Section 5.1)
 */
export interface IncomingGoodsRequest {
  wms_id: string;
  company_code: number;
  owner: number;
  customs_document_type: CustomsDocumentType;
  ppkek_number: string;
  customs_registration_date: string; // YYYY-MM-DD
  incoming_evidence_number: string;
  incoming_date: string; // YYYY-MM-DD
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  shipper_name: string;
  items: IncomingGoodsItem[];
  timestamp: string; // ISO 8601
}

export interface IncomingGoodsItem {
  item_type: string;
  item_code: string;
  item_name: string;
  hs_code?: string | null;
  uom: string;
  qty: number;
  currency: Currency;
  amount: number;
}

/**
 * Material Usage Request (API Contract Section 5.2)
 */
export interface MaterialUsageRequest {
  wms_id: string;
  company_code: number;
  owner?: number;                     // For consignment scenarios (NEW in v3.3.0)
  work_order_number?: string | null;
  cost_center_number?: string | null;
  internal_evidence_number: string;
  transaction_date: string;
  reversal?: string | null;
  items: MaterialUsageItem[];
  timestamp: string;
}

export interface MaterialUsageItem {
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  component_demand_qty?: number | null;  // Planned material qty for Work Order (NEW in v3.3.0)
  ppkek_number?: string | null;
}

/**
 * WIP Balance Request (API Contract Section 5.3)
 */
export interface WIPBalanceRequest {
  records: WIPBalanceRecord[];
}

export interface WIPBalanceRecord {
  wms_id: string;
  company_code: number;
  item_type: string;
  item_code: string;
  item_name: string;
  stock_date: string;
  uom: string;
  qty: number;
  timestamp: string;
}

/**
 * Production Output Request (API Contract Section 5.4)
 */
export interface ProductionOutputRequest {
  wms_id: string;
  company_code: number;
  owner?: number;                     // For consignment scenarios (NEW in v3.3.0)
  internal_evidence_number: string;
  transaction_date: string;
  reversal?: string | null;
  items: ProductionOutputItem[];
  timestamp: string;
}

export interface ProductionOutputItem {
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  work_order_number: string;
}

/**
 * Outgoing Goods Request (API Contract Section 5.5)
 */
export interface OutgoingGoodsRequest {
  wms_id: string;
  company_code: number;
  owner: number;
  customs_document_type: CustomsDocumentType;
  ppkek_number: string;
  customs_registration_date: string;
  outgoing_evidence_number: string;
  outgoing_date: string;
  invoice_number: string;
  invoice_date: string;
  recipient_name: string;
  items: OutgoingGoodsItem[];
  timestamp: string;
}

export interface OutgoingGoodsItem {
  item_type: string;
  item_code: string;
  item_name: string;
  work_order_allocations?: WorkOrderAllocation[];  // NEW v3.3.0 (recommended format)
  production_output_wms_ids?: string[];             // DEPRECATED (backward compatibility)
  hs_code?: string | null;
  uom: string;
  qty: number;
  currency: Currency;
  amount: number;
}

/**
 * Adjustments Request (API Contract Section 5.6)
 */
export interface AdjustmentsRequest {
  wms_id: string;
  company_code: number;
  wms_doc_type?: string | null;
  internal_evidence_number: string;
  transaction_date: string;
  items: AdjustmentItem[];
  timestamp: string;
}

export interface AdjustmentItem {
  adjustment_type: AdjustmentType;
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
  qty: number;
  reason?: string | null;
}