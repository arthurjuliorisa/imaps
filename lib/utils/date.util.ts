import { startOfDay, isBefore, parseISO, isValid, format } from 'date-fns';

/**
 * Check if a date is before today (backdated)
 */
export const isBackdated = (date: Date | string): boolean => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  const today = startOfDay(new Date());
  const checkDate = startOfDay(dateObj);
  
  return isBefore(checkDate, today);
};

/**
 * Validate date string format (YYYY-MM-DD)
 */
export const isValidDateFormat = (dateStr: string): boolean => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    return false;
  }
  
  const date = parseISO(dateStr);
  return isValid(date);
};

/**
 * Check if date is in the future
 */
export const isFutureDate = (date: Date | string): boolean => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  const today = startOfDay(new Date());
  const checkDate = startOfDay(dateObj);
  
  return checkDate > today;
};

/**
 * Format date to YYYY-MM-DD
 */
export const formatDateString = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

/**
 * Parse date string to Date object
 */
export const parseDateString = (dateStr: string): Date => {
  return parseISO(dateStr);
};

/**
 * Get start of day for a date
 */
export const getStartOfDay = (date: Date | string): Date => {
  const dateObj = typeof date === 'string' ? parseISO(date) : date;
  return startOfDay(dateObj);
};