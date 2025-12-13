/**
 * API Client for iMAPS v2.4.2
 *
 * Centralized HTTP client for making API requests.
 * Handles authentication, error handling, and response parsing.
 */

import { ApiResponse, ApiErrorResponse } from '@/types/v2.4.2';

/**
 * Base API URL
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

/**
 * HTTP Methods
 */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Request Options
 */
interface RequestOptions {
  method?: HttpMethod;
  body?: any;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * API Client Error
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: ApiErrorResponse
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Make HTTP request
 */
async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = options;

  // Build URL
  const url = `${API_BASE_URL}${endpoint}`;

  // Prepare headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers
  };

  // Prepare request options
  const fetchOptions: RequestInit = {
    method,
    headers: requestHeaders,
    signal
  };

  // Add body for non-GET requests
  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchOptions);

    // Parse response
    const data: ApiResponse<T> = await response.json();

    // Handle error responses
    if (!response.ok || !data.success) {
      const errorData = data as ApiErrorResponse;
      throw new ApiClientError(
        errorData.message || 'An error occurred',
        response.status,
        errorData
      );
    }

    // Return data
    return (data as any).data;
  } catch (error) {
    // Handle network errors
    if (error instanceof ApiClientError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new ApiClientError('Request cancelled', 0);
      }

      throw new ApiClientError(
        error.message || 'Network error occurred',
        0
      );
    }

    throw new ApiClientError('Unknown error occurred', 0);
  }
}

/**
 * API Client
 */
export const apiClient = {
  /**
   * GET request
   */
  get: <T>(endpoint: string, signal?: AbortSignal): Promise<T> => {
    return request<T>(endpoint, { method: 'GET', signal });
  },

  /**
   * POST request
   */
  post: <T>(endpoint: string, body?: any, signal?: AbortSignal): Promise<T> => {
    return request<T>(endpoint, { method: 'POST', body, signal });
  },

  /**
   * PUT request
   */
  put: <T>(endpoint: string, body?: any, signal?: AbortSignal): Promise<T> => {
    return request<T>(endpoint, { method: 'PUT', body, signal });
  },

  /**
   * PATCH request
   */
  patch: <T>(endpoint: string, body?: any, signal?: AbortSignal): Promise<T> => {
    return request<T>(endpoint, { method: 'PATCH', body, signal });
  },

  /**
   * DELETE request
   */
  delete: <T>(endpoint: string, signal?: AbortSignal): Promise<T> => {
    return request<T>(endpoint, { method: 'DELETE', signal });
  }
};

/**
 * Build query string from params
 */
export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach(v => searchParams.append(key, String(v)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

/**
 * Format date for API
 */
export function formatDateForApi(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Format datetime for API
 */
export function formatDateTimeForApi(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString(); // ISO 8601 format
}

/**
 * Parse date from API
 */
export function parseDateFromApi(dateString: string): Date {
  return new Date(dateString);
}
