/**
 * TypeScript interfaces matching API Contract v2.4
 */

export type CustomsDocumentType = 'BC23' | 'BC27' | 'BC40' | 'BC30' | 'BC25' | 'BC261' | 'BC262';
export type Currency = 'USD' | 'IDR' | 'CNY' | 'EUR' | 'JPY';
export type AdjustmentType = 'GAIN' | 'LOSS';

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
  work_order_numbers: string[];
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
  production_output_wms_ids?: string[];
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