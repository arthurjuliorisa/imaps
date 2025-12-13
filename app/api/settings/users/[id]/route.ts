import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
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
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await prisma.users.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
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

    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/settings/users/[id]
 * Updates an existing user
 * Can optionally update password (will be hashed)
 *
 * Request body:
 * - username: string (required, unique, min 3 chars)
 * - email: string (required, unique, valid email format)
 * - password: string (optional, min 8 chars if provided)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['username', 'email']);

    // Trim string fields
    const data = trimStringFields({
      username: body.username,
      email: body.email,
      password: body.password,
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
      password?: string;
    } = {
      username: data.username,
      email: data.email,
    };

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
 * Cascade deletes related UserAccessMenu records (handled by Prisma)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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
