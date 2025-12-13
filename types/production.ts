export interface ProductionOutputHeaderData {
  productionDate: Date;
  batchNumber: string;
  remarks?: string;
}

export interface ProductionOutputItem {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  quantity: number;
  qualityGrade: 'A' | 'B' | 'C' | 'REJECT';
  workOrderNumbers: string[];
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
