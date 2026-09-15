export interface ScrapTransaction {
  id: string;
  companyName: string;
  transactionType: string;
  docType: string;
  ppkekNumber: string;
  regDate: string;
  docNumber: string;
  docDate: string;
  transactionDate: string;
  recipientName: string;
  itemType: string;
  itemCode: string;
  itemName: string;
  unit: string;
  inQty: number;
  outQty: number;
  currency: string;
  valueAmount: number;
  remarks: string;
  createdAt: string;
  customsDocumentType?: string;
  transactionNumber?: string;
  incomingPpkekNumbers?: string[];
  inswTransactionId?: number | null;
  itemCount?: number;
  inswStatus?: 'NOT_SENT' | 'PENDING' | 'FAILED' | 'SUCCESS';
  isSez?: boolean;
  /** A summary row represents a header; a detail row represents this exact line. */
  view?: 'summary' | 'detail';
}

export interface CapitalGoodsTransaction {
  id: string;
  companyName: string;
  transactionType: string;
  docType: string;
  ppkekNumber: string;
  regDate: string;
  docNumber: string;
  docDate: string;
  transactionDate: string;
  recipientName: string;
  itemType: string;
  itemCode: string;
  itemName: string;
  unit: string;
  inQty: number;
  outQty: number;
  currency: string;
  valueAmount: number;
  remarks: string;
  createdAt: string;
}
