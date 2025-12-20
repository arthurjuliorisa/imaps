import { ZodError } from 'zod';
import type { ErrorDetail } from '@/lib/types/api-response';

/**
 * Transform Zod validation errors to API error format
 * 
 * Converts Zod errors like:
 *   path: ["items", 0, "item_type"]
 *   code: "too_big"
 * 
 * To API format:
 *   location: "item"
 *   item_index: 1
 *   item_code: "..."
 *   field: "item_type"
 *   code: "INVALID_VALUE"
 *   message: "Item type must be no more than 50 characters"
 */
export function transformZodErrors(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path as (string | number)[];
    
    // Determine if error is at header or item level
    if (path.length === 0 || (path.length === 1 && typeof path[0] === 'string')) {
      // Header level error
      return {
        location: 'header',
        field: path.join('.'),
        code: mapZodCodeToApiCode(issue.code, issue.message),
        message: formatErrorMessage(issue.code, issue.message, path),
      };
    }
    
    if (path[0] === 'items' && typeof path[1] === 'number') {
      // Item level error: items[index].field
      const itemIndex = path[1];
      const field = path.slice(2).join('.');
      
      return {
        location: 'item',
        item_index: itemIndex, // 0-based index, but API typically shows 1-based
        item_code: '', // Will be filled by caller if available
        field,
        code: mapZodCodeToApiCode(issue.code, issue.message),
        message: formatErrorMessage(issue.code, issue.message, path),
      };
    }
    
    // Fallback for other errors
    return {
      location: 'header',
      field: path.join('.'),
      code: mapZodCodeToApiCode(issue.code, issue.message),
      message: formatErrorMessage(issue.code, issue.message, path),
    };
  });
}

/**
 * Map Zod error codes to semantic API error codes
 */
function mapZodCodeToApiCode(zodCode: string, message: string): string {
  // Zod code mapping
  const codeMap: Record<string, string> = {
    'invalid_type': checkIfRequired(message) ? 'MISSING_REQUIRED' : 'INVALID_TYPE',
    'too_small': 'INVALID_VALUE',
    'too_big': 'INVALID_VALUE',
    'invalid_enum': 'INVALID_VALUE',
    'invalid_string': 'INVALID_FORMAT',
    'custom': 'VALIDATION_ERROR',
    'invalid_date': 'INVALID_FORMAT',
  };
  
  return codeMap[zodCode] || 'VALIDATION_ERROR';
}

/**
 * Check if error is about required field
 */
function checkIfRequired(message: string): boolean {
  return message.toLowerCase().includes('required') || 
         message.toLowerCase().includes('expected');
}

/**
 * Format error message to be more business-friendly
 */
function formatErrorMessage(
  zodCode: string, 
  originalMessage: string, 
  path: (string | number)[]
): string {
  const fieldName = path[path.length - 1];
  const fieldLabel = formatFieldLabel(String(fieldName));
  
  // Map Zod messages to friendly messages
  const messageMap: Record<string, string> = {
    'invalid_type': `${fieldLabel} is required`,
    'too_small': `${fieldLabel} must be longer`,
    'too_big': `${fieldLabel} must be shorter`,
    'invalid_enum': `${fieldLabel} has an invalid value`,
    'invalid_string': `${fieldLabel} has an invalid format`,
    'invalid_date': `${fieldLabel} must be a valid date`,
  };
  
  // If we have a mapped message, use it; otherwise parse the Zod message
  if (messageMap[zodCode]) {
    return messageMap[zodCode];
  }
  
  // Try to extract useful info from Zod message
  if (zodCode === 'too_big' && originalMessage.includes('<=')) {
    const match = originalMessage.match(/<=(\d+)/);
    if (match) {
      return `${fieldLabel} must be no more than ${match[1]} characters`;
    }
  }
  
  if (zodCode === 'too_small' && originalMessage.includes('>=')) {
    const match = originalMessage.match(/>=(\d+)/);
    if (match) {
      return `${fieldLabel} must be at least ${match[1]} characters`;
    }
  }
  
  // Fallback to original message
  return originalMessage;
}

/**
 * Convert field name to readable label
 * e.g., "item_code" -> "Item Code", "ppkekNumber" -> "PPKEK Number"
 */
function formatFieldLabel(fieldName: string): string {
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
