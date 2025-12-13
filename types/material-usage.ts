export interface MaterialUsageHeaderData {
  usageDate: Date;
  workOrderNumber: string;
  remarks?: string;
}

export interface MaterialUsageItem {
  id: string;
  itemCode: string;
  itemName: string;
  itemType: 'ROH' | 'HALB';
  uom: string;
  quantity: number;
  ppkekNumber: string;
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
