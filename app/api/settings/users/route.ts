import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { authOptions } from '@/lib/auth';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
  validateEmail,
  ValidationError,
  getPaginationParams,
  createPaginatedResponse,
} from '@/lib/api-utils';

/**
 * GET /api/settings/users
 * Retrieves users with pagination (NEVER returns passwords)
 *
 * SUPER_ADMIN: Can view all users
 * Other roles: Can only view users from their assigned company
 *
 * Query parameters:
 * - page: number (default: 1)
 * - limit: number (default: 10, max: 100)
 * - search: string (optional, searches username and email)
 */
export async function GET(request: NextRequest) {
  try {
    // ==================== AUTHENTICATION & AUTHORIZATION ====================
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    const userRole = (session.user as any)?.role;
    const userCompanyCode = (session.user as any)?.companyCode;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const searchParams = request.nextUrl.searchParams;
    const { skip, take, page, limit } = getPaginationParams(searchParams);
    const search = searchParams.get('search')?.trim() || '';

    // Build where clause for search
    const searchWhere = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    // ===================== COMPANY FILTERING LOGIC =====================
    // SUPER_ADMIN can see all users
    // Other roles can only see users from their company
    const companyFilter =
      !isSuperAdmin && userCompanyCode
        ? { company_code: parseInt(userCompanyCode, 10) }
        : {};

    const where = {
      ...searchWhere,
      ...companyFilter,
    };

    // Get total count
    const total = await prisma.users.count({ where });

    // Get paginated users (EXCLUDE password field)
    const users = await prisma.users.findMany({
      where,
      skip,
      take,
      select: {
        id: true,
        username: true,
        email: true,
        full_name: true,
        role: true,
        company_code: true,
        company: {
          select: {
            code: true,
            name: true,
          },
        },
        created_at: true,
        updated_at: true,
      },
      orderBy: { username: 'asc' },
    });

    return NextResponse.json(
      createPaginatedResponse(users, total, page, limit)
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/settings/users
 * Creates a new user with hashed password
 *
 * SUPER_ADMIN: Can create users in any company
 * Other roles: Can only create users in their own company
 *
 * Request body:
 * - username: string (required, unique, min 3 chars)
 * - email: string (required, unique, valid email format)
 * - password: string (required, min 8 chars)
 * - full_name: string (required)
 * - role: string (optional, default: USER)
 * - company_code: number (required for non-SUPER_ADMIN)
 */
export async function POST(request: NextRequest) {
  try {
    // ==================== AUTHENTICATION & AUTHORIZATION ====================
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 }
      );
    }

    const userRole = (session.user as any)?.role;
    const userCompanyCode = (session.user as any)?.companyCode;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['username', 'email', 'password', 'full_name']);

    // Trim string fields
    const data = trimStringFields({
      username: body.username,
      email: body.email,
      password: body.password,
      full_name: body.full_name,
    });

    // Validate username length
    if (data.username.length < 3) {
      throw new ValidationError('Username must be at least 3 characters long');
    }

    // Validate email format
    if (!validateEmail(data.email)) {
      throw new ValidationError('Invalid email format');
    }

    // Validate password length
    if (data.password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Parse company_code to integer
    const requestedCompanyCode = body.company_code
      ? parseInt(body.company_code, 10)
      : null;

    // ===================== COMPANY AUTHORIZATION =====================
    // Non-SUPER_ADMIN can only create users in their own company
    if (!isSuperAdmin) {
      if (!userCompanyCode) {
        return NextResponse.json(
          { error: 'You do not have a company assigned' },
          { status: 403 }
        );
      }

      if (requestedCompanyCode !== userCompanyCode) {
        return NextResponse.json(
          {
            error: `You can only create users in your assigned company (${userCompanyCode})`,
          },
          { status: 403 }
        );
      }
    }

    // Create user
    const id = `USER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const user = await prisma.users.create({
      data: {
        id,
        username: data.username,
        email: data.email,
        password: hashedPassword,
        full_name: data.full_name,
        role: body.role || 'USER',
        company_code: requestedCompanyCode,
        updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        email: true,
        full_name: true,
        role: true,
        company_code: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
