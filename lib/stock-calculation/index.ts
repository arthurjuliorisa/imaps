/**
 * Stock Calculation Module
 *
 * Complete stock calculation engine for iMAPS system.
 * Provides calculation, validation, and utility functions for
 * daily stock snapshot management.
 *
 * @module StockCalculation
 */

// Export engine
export {
  StockCalculationEngine,
  createStockCalculationEngine,
  getStockCalculationEngine,
  type CalculationResult,
  type ValidationResult,
  type CascadeResult,
  type StockBalance,
  type CalculationOptions,
  type CascadeOptions,
  type BalanceOptions,
} from './engine';

// Export validators
export {
  validators,
  validateItemType,
  isCapitalGoodsType as isCapitalGoodsTypeValidator,
  validateDateRange,
  validateCalculationDate,
  validateCompanyCode,
  validateItemCode,
  validateQuantity,
  checkNegativeStock,
  validateTransactionConsistency,
  validateSnapshot,
  validateBeginningBalance,
  type ValidationError,
  type SnapshotValidationResult,
  type TransactionValidationResult,
  type BalanceCheckResult,
} from './validators';

// Export helpers
export {
  helpers,
  ITEM_TYPES,
  getItemTypeInfo,
  getAllItemTypes,
  isCapitalGoodsType,
  formatDate,
  parseDate,
  addDays,
  subtractDays,
  getDateRange,
  getMonthRange,
  getPreviousDay,
  getNextDay,
  calculateROHBalance,
  calculateFERTBalance,
  calculateHIBEBalance,
  calculateSCRAPBalance,
  formatQuantity,
  formatCurrency,
  formatPercentage,
  getStockMovementSummary,
  getStockStatistics,
  findMissingSnapshots,
  checkDataConsistency,
  batchProcessItems,
  type DateRange,
  type ItemTypeInfo,
  type StockMovementSummary,
  type StockStatistics,
  type ConsistencyCheckResult,
} from './helpers';

// Default export
export { StockCalculationEngine as default } from './engine';
