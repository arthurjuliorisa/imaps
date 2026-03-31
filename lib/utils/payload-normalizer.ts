/**
 * Normalize WMS payload structure for consistent storage and audit trail
 * Reorders payload fields to match expected structure:
 * 1. Header fields (wms_id, company_code, etc.)
 * 2. Items array
 * 3. Timestamp at end
 */

interface WmsPayloadHeader {
  wms_id?: string;
  company_code?: number;
  owner?: number;
  customs_document_type?: string;
  ppkek_number?: string;
  customs_registration_date?: string;
  incoming_evidence_number?: string;
  incoming_date?: string;
  invoice_number?: string;
  invoice_date?: string;
  shipper_name?: string;
  blank1?: any;
  blank2?: any;
  blank3?: any;
  transaction_date?: string;
  doc_date?: string;
  registration_date?: string;
  evidence_number?: string;
  [key: string]: any;
}

/**
 * Define the standard field order for different transaction types
 */
const FIELD_ORDER: Record<string, string[]> = {
  // Incoming goods header fields
  incoming_goods: [
    'wms_id',
    'company_code',
    'owner',
    'customs_document_type',
    'ppkek_number',
    'customs_registration_date',
    'incoming_evidence_number',
    'incoming_date',
    'invoice_number',
    'invoice_date',
    'shipper_name',
    'blank1',
  ],
  // Outgoing goods header fields (BC30/BC25 Export/Local Sales)
  outgoing_goods: [
    'wms_id',
    'company_code',
    'owner',
    'customs_document_type',
    'ppkek_number',
    'customs_registration_date',
    'outgoing_evidence_number',
    'outgoing_date',
    'invoice_number',
    'invoice_date',
    'recipient_name',
    'blank1',
  ],
  // Stock opname header fields
  stock_opname: [
    'wms_id',
    'company_code',
    'doc_date',
    'transaction_date',
    'blank1',
  ],
  // Material usage header fields
  material_usage: [
    'wms_id',
    'company_code',
    'doc_date',
    'transaction_date',
    'blank1',
  ],
  // Production output header fields
  production_output: [
    'wms_id',
    'company_code',
    'doc_date',
    'transaction_date',
    'blank1',
  ],
  // Adjustments header fields
  adjustments: [
    'wms_id',
    'company_code',
    'doc_date',
    'transaction_date',
    'blank1',
  ],
};

/**
 * Normalize WMS payload by reordering fields
 * @param payload Original WMS payload
 * @param transactionType Type of transaction (incoming_goods, outgoing_goods, etc.)
 * @returns Normalized payload with ordered fields
 */
export function normalizeWmsPayload(payload: any, transactionType: string = 'incoming_goods'): any {
  try {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const normalized: any = {};
    const fieldOrder = FIELD_ORDER[transactionType] || FIELD_ORDER.incoming_goods;
    const items = payload.items;
    const timestamp = payload.timestamp;

    // 1. Add header fields in defined order
    for (const field of fieldOrder) {
      if (field in payload) {
        normalized[field] = payload[field];
      }
    }

    // 2. Add any remaining header fields not in the order list (except items and timestamp)
    for (const [key, value] of Object.entries(payload)) {
      if (
        key !== 'items' &&
        key !== 'timestamp' &&
        !fieldOrder.includes(key) &&
        !(key in normalized)
      ) {
        normalized[key] = value;
      }
    }

    // 3. Add items array
    if (items !== undefined) {
      normalized.items = Array.isArray(items)
        ? items.map((item, index) => {
            try {
              return normalizeItemPayload(item);
            } catch (itemError) {
              console.error('[normalizeWmsPayload] Error normalizing item at index', {
                index,
                item_code: item?.item_code,
                error: itemError instanceof Error ? itemError.message : String(itemError),
              });
              // Return item as-is if normalization fails
              return item;
            }
          })
        : items;
    }

    // 4. Add timestamp at the end
    if (timestamp !== undefined) {
      normalized.timestamp = timestamp;
    }

    return normalized;
  } catch (error) {
    console.error('[normalizeWmsPayload] Critical error during normalization:', {
      transactionType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Return original payload if normalization completely fails
    return payload;
  }
}

/**
 * Normalize item payload structure
 * Reorders item fields for consistent structure
 */
function normalizeItemPayload(item: any): any {
  if (!item || typeof item !== 'object') {
    return item;
  }

  const itemFieldOrder = [
    'item_type',
    'item_code',
    'item_name',
    'hs_code',
    'uom',
    'qty',
    'currency',
    'amount',
    'blank2',
    'blank3',
  ];

  const normalized: any = {};

  // Add fields in order
  for (const field of itemFieldOrder) {
    if (field in item) {
      normalized[field] = item[field];
    }
  }

  // Add any remaining fields not in order
  for (const [key, value] of Object.entries(item)) {
    if (!itemFieldOrder.includes(key) && !(key in normalized)) {
      normalized[key] = value;
    }
  }

  return normalized;
}

/**
 * Determine transaction type from WMS action
 */
export function getTransactionTypeFromAction(action: string): string {
  if (action.includes('INCOMING')) return 'incoming_goods';
  if (action.includes('OUTGOING')) return 'outgoing_goods';
  if (action.includes('STOCK_OPNAME')) return 'stock_opname';
  if (action.includes('MATERIAL_USAGE')) return 'material_usage';
  if (action.includes('PRODUCTION')) return 'production_output';
  if (action.includes('ADJUSTMENT')) return 'adjustments';
  if (action.includes('WIP_BALANCE')) return 'wip_balance';
  return 'incoming_goods';
}
