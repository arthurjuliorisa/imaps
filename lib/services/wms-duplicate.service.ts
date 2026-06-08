import { prisma } from '@/lib/db/prisma';
import type { ErrorDetail } from '@/lib/types/api-response';

export const DUPLICATE_WMS_ID_ERROR_CODE = 'DUPLICATE_WMS_ID_NOT_ALLOWED';

export type DuplicateTransactionType =
  | 'incoming_goods'
  | 'material_usage'
  | 'production_output'
  | 'outgoing_goods'
  | 'adjustment';

const DUPLICATE_WMS_ID_MESSAGE =
  'This WMS ID has already been submitted to iMAPS for this company and transaction type. Please use a new WMS ID or use the designated correction, reversal, adjustment, or revision mechanism.';

export function createDuplicateWmsIdError(): ErrorDetail {
  return {
    location: 'header',
    field: 'wms_id',
    code: DUPLICATE_WMS_ID_ERROR_CODE,
    message: DUPLICATE_WMS_ID_MESSAGE,
  };
}

export function isDuplicateWmsIdError(errors: Array<{ code?: string }> | undefined): boolean {
  return Boolean(errors?.some((error) => error.code === DUPLICATE_WMS_ID_ERROR_CODE));
}

export async function assertWmsIdNotExists(params: {
  transactionType: DuplicateTransactionType;
  companyCode: number;
  wmsId: string;
}): Promise<ErrorDetail[]> {
  const exists = await hasExistingWmsId(params);
  return exists ? [createDuplicateWmsIdError()] : [];
}

async function hasExistingWmsId(params: {
  transactionType: DuplicateTransactionType;
  companyCode: number;
  wmsId: string;
}): Promise<boolean> {
  const where = {
    company_code: params.companyCode,
    wms_id: params.wmsId,
    deleted_at: null,
  };

  switch (params.transactionType) {
    case 'incoming_goods':
      return Boolean(await prisma.incoming_goods.findFirst({ where, select: { id: true } }));
    case 'material_usage':
      return Boolean(await prisma.material_usages.findFirst({ where, select: { id: true } }));
    case 'production_output':
      return Boolean(await prisma.production_outputs.findFirst({ where, select: { id: true } }));
    case 'outgoing_goods':
      return Boolean(await prisma.outgoing_goods.findFirst({ where, select: { id: true } }));
    case 'adjustment':
      return Boolean(await prisma.adjustments.findFirst({ where, select: { id: true } }));
    default: {
      const exhaustiveCheck: never = params.transactionType;
      throw new Error(`Unsupported duplicate WMS ID transaction type: ${exhaustiveCheck}`);
    }
  }
}
