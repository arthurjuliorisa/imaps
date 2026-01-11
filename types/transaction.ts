export interface ScrapTransaction {
  id: string;
  companyName: string;
  transactionType: string;
  docType: string;
  ppkekNumber: string;
  regDate: string;
  docNumber: string;
  docDate: string;
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
