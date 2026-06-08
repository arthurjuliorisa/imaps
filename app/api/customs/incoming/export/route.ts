import { NextRequest } from 'next/server';
import { handleTransactionExportRequest } from '@/lib/customs/transaction-export-route';

export async function GET(request: NextRequest) {
  return handleTransactionExportRequest(request, 'incoming');
}
