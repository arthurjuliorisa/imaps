/**
 * User Role Utilities
 * Provides helper functions for user role checking
 */

/**
 * Check if user has CUSTOMS role
 * @param role - User role from session
 * @returns true if user is CUSTOMS, false otherwise
 */
export const isCustomsUser = (role?: string): boolean => {
  return role === 'CUSTOMS';
};

/**
 * Check if user has INTERNAL role (any non-CUSTOMS role)
 * @param role - User role from session
 * @returns true if user is not CUSTOMS, false otherwise
 */
export const isInternalUser = (role?: string): boolean => {
  return !isCustomsUser(role);
};

/**
 * Check if user can view system quantities (only INTERNAL users)
 * @param role - User role from session
 * @returns true if user can view system qty, false otherwise
 */
export const canViewSystemQty = (role?: string): boolean => {
  return isInternalUser(role);
};
