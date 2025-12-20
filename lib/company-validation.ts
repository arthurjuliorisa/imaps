import { NextResponse } from 'next/server';

/**
 * Validates and extracts company code from session
 * Returns either the company code or a detailed error response
 */
export function validateCompanyCode(session: any): {
  success: true;
  companyCode: number;
} | {
  success: false;
  response: NextResponse;
} {
  // Check if session exists
  if (!session?.user) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Sesi Anda telah berakhir',
          details: 'Silakan logout dan login kembali untuk melanjutkan.',
          action: 'LOGIN_REQUIRED',
        },
        { status: 401 }
      ),
    };
  }

  // Check if companyCode exists in session
  if (!session.user.companyCode) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'COMPANY_CODE_MISSING',
          message: 'Data perusahaan tidak ditemukan',
          details: 'Akun Anda belum terhubung dengan perusahaan manapun. Hubungi administrator untuk mengatur company code pada akun Anda.',
          technicalInfo: {
            userId: session.user.id,
            email: session.user.email,
            issue: 'session.user.companyCode is null or undefined',
          },
          action: 'CONTACT_ADMIN',
        },
        { status: 400 }
      ),
    };
  }

  // Parse and validate companyCode
  const companyCode = parseInt(session.user.companyCode);

  if (isNaN(companyCode) || companyCode <= 0) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'INVALID_COMPANY_CODE',
          message: 'Kode perusahaan tidak valid',
          details: `Company code "${session.user.companyCode}" bukan angka yang valid. Hubungi administrator untuk memperbaiki data akun Anda.`,
          technicalInfo: {
            userId: session.user.id,
            email: session.user.email,
            companyCodeValue: session.user.companyCode,
            issue: 'companyCode is not a valid positive integer',
          },
          action: 'CONTACT_ADMIN',
        },
        { status: 400 }
      ),
    };
  }

  // Success - return valid company code
  return {
    success: true,
    companyCode,
  };
}

/**
 * User-friendly error message mapping for frontend
 */
export const COMPANY_VALIDATION_ERRORS = {
  AUTHENTICATION_REQUIRED: {
    title: 'Sesi Berakhir',
    message: 'Silakan login kembali',
    icon: 'lock',
  },
  COMPANY_CODE_MISSING: {
    title: 'Data Perusahaan Tidak Ada',
    message: 'Akun Anda belum terhubung dengan perusahaan. Hubungi administrator.',
    icon: 'warning',
  },
  INVALID_COMPANY_CODE: {
    title: 'Kode Perusahaan Tidak Valid',
    message: 'Ada masalah dengan data akun Anda. Hubungi administrator.',
    icon: 'error',
  },
} as const;
