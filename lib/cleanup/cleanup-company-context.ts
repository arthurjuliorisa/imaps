import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export interface CleanupCompanyContext {
  user: {
    id: string;
    email: string;
    role: string;
    company_code: number;
  };
  company: {
    code: number;
    name: string;
  };
  companyCode: number;
}

export class CleanupCompanyContextError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CleanupCompanyContextError';
    this.status = status;
    this.code = code;
  }
}

export async function resolveCleanupCompanyContext(): Promise<CleanupCompanyContext> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new CleanupCompanyContextError(401, 'Unauthorized', 'Authentication required');
  }

  const sessionCompanyCode = Number(session.user.companyCode);
  if (!Number.isInteger(sessionCompanyCode) || sessionCompanyCode <= 0) {
    throw new CleanupCompanyContextError(
      400,
      'INVALID_SESSION_COMPANY',
      'Authenticated company could not be resolved for database cleanup.'
    );
  }

  const user = await prisma.users.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, role: true, company_code: true },
  });

  if (!user || user.role !== 'ADMIN') {
    throw new CleanupCompanyContextError(403, 'Forbidden', 'Admin role required');
  }

  if (user.company_code !== sessionCompanyCode) {
    throw new CleanupCompanyContextError(
      400,
      'USER_COMPANY_MISMATCH',
      `Cleanup company validation failed. Session company ${sessionCompanyCode} does not match the authenticated user's company.`
    );
  }

  const company = await prisma.companies.findUnique({
    where: { code: sessionCompanyCode },
    select: { code: true, name: true },
  });

  if (!company) {
    throw new CleanupCompanyContextError(
      400,
      'COMPANY_NOT_FOUND',
      `Cleanup company ${sessionCompanyCode} was not found.`
    );
  }

  return {
    user: {
      ...user,
      company_code: sessionCompanyCode,
    },
    company,
    companyCode: sessionCompanyCode,
  };
}
