// ============================================================================
// FILE: app/api/setup-db/route.ts
// API endpoint untuk trigger setup dari Vercel
// ============================================================================

import { NextResponse } from 'next/server';
import { setupCompleteDatabase, verifyDatabaseSetup } from '@/lib/db-setup-complete';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes (Vercel Pro/Enterprise)

export async function POST(request: Request) {
  try {
    // Security check
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.ADMIN_SETUP_TOKEN;
    
    if (!expectedToken) {
      return NextResponse.json(
        { error: 'ADMIN_SETUP_TOKEN not configured in environment variables' },
        { status: 500 }
      );
    }
    
    if (authHeader !== `Bearer ${expectedToken}`) {
      console.warn('Unauthorized setup attempt');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('Starting database setup via API...');
    
    // Execute complete setup
    const result = await setupCompleteDatabase();
    
    return NextResponse.json({
      message: 'Database setup completed successfully',
      ...result
    });
    
  } catch (error: any) {
    console.error('Setup API error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Unknown error occurred',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.ADMIN_SETUP_TOKEN;
    
    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify current state
    const verification = await verifyDatabaseSetup();
    
    return NextResponse.json({
      success: true,
      verification,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}