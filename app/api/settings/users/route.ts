import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
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
 * Retrieves all users with pagination (NEVER returns passwords)
 *
 * Query parameters:
 * - page: number (default: 1)
 * - limit: number (default: 10, max: 100)
 * - search: string (optional, searches username and email)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { skip, take, page, limit } = getPaginationParams(searchParams);
    const search = searchParams.get('search')?.trim() || '';

    // Build where clause for search
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

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
 * Request body:
 * - username: string (required, unique, min 3 chars)
 * - email: string (required, unique, valid email format)
 * - password: string (required, min 8 chars)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['username', 'email', 'password']);

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

    // Validate password length
    if (data.password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create user
    const id = `USER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const user = await prisma.users.create({
      data: {
        id,
        username: data.username,
        email: data.email,
        password: hashedPassword,
        updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        email: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
