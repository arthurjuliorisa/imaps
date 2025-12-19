import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  AppError,
} from '../utils/error.util';
import { logger } from '../utils/logger';

/**
 * Global error handler middleware
 */
export const errorHandler = (error: unknown, wmsId?: string) => {
  // Handle known errors
  if (error instanceof AppError) {
    return handleAppError(error, wmsId);
  }

  // Handle Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return handlePrismaError(error, wmsId);
  }

  // Handle unknown errors
  return handleUnknownError(error, wmsId);
};

/**
 * Handle AppError and its subclasses
 */
const handleAppError = (error: AppError, wmsId?: string) => {
  logger.error(
    'Application error',
    {
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
      },
      wmsId,
    }
  );

  return NextResponse.json(
    {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    },
    { status: error.statusCode }
  );
};

/**
 * Handle Prisma database errors
 */
const handlePrismaError = (error: Prisma.PrismaClientKnownRequestError, wmsId?: string) => {
  logger.error(
    'Database error',
    {
      error: {
        code: error.code,
        message: error.message,
        meta: error.meta,
      },
      wmsId,
    }
  );

  // Handle specific Prisma error codes
  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A record with this identifier already exists',
          },
        },
        { status: 409 }
      );

    case 'P2003':
      // Foreign key constraint violation
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_REFERENCE',
            message: 'Referenced record does not exist',
          },
        },
        { status: 400 }
      );

    case 'P2025':
      // Record not found
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Record not found',
          },
        },
        { status: 404 }
      );

    default:
      // Generic database error
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'An error occurred while processing your request',
          },
        },
        { status: 500 }
      );
  }
};

/**
 * Handle unknown errors
 */
const handleUnknownError = (error: unknown, wmsId?: string) => {
  logger.error(
    'Unexpected error',
    {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      wmsId,
    }
  );

  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    },
    { status: 500 }
  );
};