import { NextRequest } from 'next/server';
import { handleLpjExportRequest } from '@/lib/customs/lpj-export-route';

export async function GET(request: NextRequest) {
  return handleLpjExportRequest(request, 'scrap');
}
