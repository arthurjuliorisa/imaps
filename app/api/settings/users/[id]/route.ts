import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { isCompanyInUserScope } from '@/lib/user-company-scope';
import {
  getRequestedCompanyCode,
  hasCompanyCodeChanged,
  hasRoleChanged,
} from '@/lib/user-update-authorization';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
  validateEmail,
  ValidationError,
} from '@/lib/api-utils';

/**
 * GET /api/settings/users/[id]
 * Retrieves a single user by ID (NEVER returns password)
 *
 * SUPER_ADMIN: Can view any user
 * Other roles: Can only view users from their company
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const sessionCompanyCode = (session.user as any)?.companyCode;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const { id } = await params;

    // Fetch the target user
    const user = await prisma.users.findUnique({
      where: { id },
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

    if (!user) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // ===================== COMPANY AUTHORIZATION =====================
    // Non-SUPER_ADMIN can only view users from their company
    if (!isSuperAdmin && !isCompanyInUserScope(sessionCompanyCode, user.company_code)) {
      return NextResponse.json(
        { error: 'You can only view users from your assigned company' },
        { status: 403 }
      );
    }

    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/settings/users/[id]
 * Updates an existing user
 *
 * SUPER_ADMIN: Can update any user
 * Other roles: Can only update users from their company
 *
 * Request body:
 * - username: string (required, unique, min 3 chars)
 * - email: string (required, unique, valid email format)
 * - password: string (optional, min 8 chars if provided)
 * - role: string (optional)
 * - company_code: number (optional)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const sessionCompanyCode = (session.user as any)?.companyCode;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const { id } = await params;
    const body = await request.json();

    // Fetch the target user once for company scope and protected-field changes.
    const targetUser = await prisma.users.findUnique({
      where: { id },
      select: { company_code: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // ===================== COMPANY AUTHORIZATION =====================
    // Non-SUPER_ADMIN can only update users from their company
    if (!isSuperAdmin && !isCompanyInUserScope(sessionCompanyCode, targetUser.company_code)) {
      return NextResponse.json(
        { error: 'You can only update users from your assigned company' },
        { status: 403 }
      );
    }

    // Validate required fields
    validateRequiredFields(body, ['username', 'email', 'full_name']);

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

    // Prepare update data
    const updateData: {
      username: string;
      email: string;
      full_name: string;
      role?: string;
      company_code?: number | null;
      password?: string;
      updated_at: Date;
    } = {
      username: data.username,
      email: data.email,
      full_name: data.full_name,
      updated_at: new Date(),
    };

    // A full edit form submits the current role and company code even when they
    // are unchanged. Restrict actual transitions, not field presence.
    const roleChanged = hasRoleChanged(body.role, targetUser.role);
    const companyChanged = hasCompanyCodeChanged(
      body.company_code,
      targetUser.company_code
    );

    // Only SUPER_ADMIN can modify roles.
    if (roleChanged) {
      if (!isSuperAdmin) {
        return NextResponse.json(
          { error: 'Only SUPER_ADMIN can change user roles' },
          { status: 403 }
        );
      }
      updateData.role = body.role;
    }

    // Only SUPER_ADMIN can modify company assignment.
    if (companyChanged) {
      if (!isSuperAdmin) {
        return NextResponse.json(
          { error: 'Only SUPER_ADMIN can change user company assignment' },
          { status: 403 }
        );
      }
      updateData.company_code = getRequestedCompanyCode(body.company_code);
    }

    // If password is provided, validate and hash it
    if (data.password && data.password.trim() !== '') {
      if (data.password.length < 8) {
        throw new ValidationError('Password must be at least 8 characters long');
      }
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    // Update user
    const user = await prisma.users.update({
      where: { id },
      data: updateData,
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

    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/settings/users/[id]
 * Deletes a user
 *
 * SUPER_ADMIN: Can delete any user
 * Other roles: Can only delete users from their company
 *
 * Cascade deletes related UserAccessMenu records (handled by Prisma schema)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const sessionCompanyCode = (session.user as any)?.companyCode;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const { id } = await params;

    // Fetch the target user first to check company
    const targetUser = await prisma.users.findUnique({
      where: { id },
      select: { company_code: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { message: 'User not found' },
        { status: 404 }
      );
    }

    // ===================== COMPANY AUTHORIZATION =====================
    // Non-SUPER_ADMIN can only delete users from their company
    if (!isSuperAdmin && !isCompanyInUserScope(sessionCompanyCode, targetUser.company_code)) {
      return NextResponse.json(
        { error: 'You can only delete users from your assigned company' },
        { status: 403 }
      );
    }

    // Delete user (cascade delete UserAccessMenu via Prisma schema)
    await prisma.users.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'User deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
