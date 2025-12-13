/**
 * API Services Index
 *
 * Central export for all API services.
 */

// Client
export { apiClient, buildQueryString, formatDateForApi, formatDateTimeForApi, parseDateFromApi, ApiClientError } from './client';

// Transaction services
export {
  // Incoming
  getIncomingTransactions,
  getIncomingTransaction,
  createIncomingTransaction,
  updateIncomingTransaction,
  deleteIncomingTransaction,

  // Outgoing
  getOutgoingTransactions,
  getOutgoingTransaction,
  createOutgoingTransaction,
  updateOutgoingTransaction,
  deleteOutgoingTransaction,

  // Material Usage
  getMaterialUsageTransactions,
  getMaterialUsageTransaction,
  createMaterialUsageTransaction,
  updateMaterialUsageTransaction,
  deleteMaterialUsageTransaction,

  // Production
  getProductionTransactions,
  getProductionTransaction,
  createProductionTransaction,
  updateProductionTransaction,
  deleteProductionTransaction,

  // WIP Balance
  getWIPBalanceTransactions,
  getWIPBalanceTransaction,
  createWIPBalanceTransaction,
  updateWIPBalanceTransaction,
  deleteWIPBalanceTransaction,

  // Adjustments
  getAdjustmentTransactions,
  getAdjustmentTransaction,
  createAdjustmentTransaction,
  updateAdjustmentTransaction,
  deleteAdjustmentTransaction
} from './transactions';

// Master data services
export {
  // Companies
  getCompanies,
  getCompany,

  // Item Types
  getItemTypes,
  getItemType,

  // Beginning Balances
  getBeginningBalances,
  getBeginningBalance,
  createBeginningBalance,
  updateBeginningBalance,
  deleteBeginningBalance,
  importBeginningBalances,

  // Search
  searchItems,
  getDistinctItems,
  searchPPKEK,
  searchWorkOrders
} from './master-data';
