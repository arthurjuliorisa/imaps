/**
 * Stock Calculation Engine - TypeScript Wrapper
 *
 * Provides a type-safe interface to the PostgreSQL stock calculation functions.
 * Handles error logging, validation, and provides convenient methods for
 * calculating stock snapshots and retrieving balances.
 *
 * @module StockCalculationEngine
 */

import { PrismaClient } from '@prisma/client';

// =====================================================================
// Types and Interfaces
// =====================================================================

export interface CalculationResult {
  itemsProcessed: number;
  calculationMethod: string;
  executionTimeMs: number;
  validationResults: ValidationResult[];
}

export interface ValidationResult {
  validationType: string;
  issueCount: number;
  details: any;
}

export interface CascadeResult {
  recalcDate: Date;
  itemsProcessed: number;
  executionTimeMs: number;
  validationResults: ValidationResult[];
}

export interface StockBalance {
  companyCode: string;
  itemCode: string;
  itemName: string;
  itemTypeCode: string;
  uom: string;
  closingBalance: number;
  snapshotDate: Date;
}

export interface CalculationOptions {
  companyCode: string;
  targetDate: Date;
  itemTypeCode?: string;
  itemCode?: string;
}

export interface CascadeOptions {
  companyCode: string;
  startDate: Date;
  endDate?: Date;
}

export interface BalanceOptions {
  companyCode: string;
  itemCode: string;
  asOfDate?: Date;
}

// =====================================================================
// Stock Calculation Engine Class
// =====================================================================

export class StockCalculationEngine {
  private prisma: PrismaClient;
  private logger?: (message: string, data?: any) => void;

  constructor(prisma: PrismaClient, logger?: (message: string, data?: any) => void) {
    this.prisma = prisma;
    this.logger = logger;
  }

  /**
   * Calculate stock snapshot for a specific date
   *
   * @param options - Calculation options
   * @returns Calculation result with items processed and validation results
   *
   * @example
   * ```typescript
   * const result = await engine.calculateSnapshot({
   *   companyCode: '1370',
   *   targetDate: new Date('2026-01-01')
   * });
   * console.log(`Processed ${result.itemsProcessed} items in ${result.executionTimeMs}ms`);
   * ```
   */
  async calculateSnapshot(options: CalculationOptions): Promise<CalculationResult> {
    const { companyCode, targetDate, itemTypeCode, itemCode } = options;

    this.log('Calculating stock snapshot', {
      companyCode,
      targetDate: targetDate.toISOString(),
      itemTypeCode,
      itemCode,
    });

    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM calculate_stock_snapshot(
          ${companyCode}::VARCHAR(50),
          ${targetDate}::DATE,
          ${itemTypeCode || null}::VARCHAR(10),
          ${itemCode || null}::VARCHAR(50)
        )
      `;

      if (!result || result.length === 0) {
        throw new Error('No result returned from stock calculation');
      }

      const row = result[0];
      const calculationResult: CalculationResult = {
        itemsProcessed: row.items_processed,
        calculationMethod: row.calculation_method,
        executionTimeMs: Number(row.execution_time_ms),
        validationResults: this.parseValidationResults(row.validation_results),
      };

      this.log('Stock snapshot calculated successfully', calculationResult);

      // Log validation issues if any
      if (calculationResult.validationResults.length > 0) {
        this.log('Validation issues detected', calculationResult.validationResults);
      }

      return calculationResult;
    } catch (error) {
      this.log('Error calculating stock snapshot', {
        error: error instanceof Error ? error.message : String(error),
        options,
      });
      throw new Error(
        `Failed to calculate stock snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Recalculate stock snapshots for a date range (cascade)
   *
   * Used for backdated transactions that affect multiple days.
   * Recalculates from startDate to endDate sequentially.
   *
   * @param options - Cascade recalculation options
   * @returns Array of calculation results for each date
   *
   * @example
   * ```typescript
   * const results = await engine.recalculateCascade({
   *   companyCode: '1370',
   *   startDate: new Date('2026-01-02'),
   *   endDate: new Date('2026-01-05')
   * });
   * ```
   */
  async recalculateCascade(options: CascadeOptions): Promise<CascadeResult[]> {
    const { companyCode, startDate, endDate } = options;

    this.log('Starting cascade recalculation', {
      companyCode,
      startDate: startDate.toISOString(),
      endDate: endDate?.toISOString(),
    });

    try {
      const results = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM recalculate_cascade(
          ${companyCode}::VARCHAR(50),
          ${startDate}::DATE,
          ${endDate || null}::DATE
        )
      `;

      const cascadeResults: CascadeResult[] = results.map((row) => ({
        recalcDate: new Date(row.recalc_date),
        itemsProcessed: row.items_processed,
        executionTimeMs: Number(row.execution_time_ms),
        validationResults: this.parseValidationResults(row.validation_results),
      }));

      this.log('Cascade recalculation completed', {
        totalDates: cascadeResults.length,
        totalItems: cascadeResults.reduce((sum, r) => sum + r.itemsProcessed, 0),
      });

      return cascadeResults;
    } catch (error) {
      this.log('Error in cascade recalculation', {
        error: error instanceof Error ? error.message : String(error),
        options,
      });
      throw new Error(
        `Failed to recalculate cascade: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get stock balance for a specific item as of a date
   *
   * @param options - Balance query options
   * @returns Stock balance or null if not found
   *
   * @example
   * ```typescript
   * const balance = await engine.getStockBalance({
   *   companyCode: '1370',
   *   itemCode: 'RM-1370-001',
   *   asOfDate: new Date('2026-01-31')
   * });
   * console.log(`Balance: ${balance?.closingBalance} ${balance?.uom}`);
   * ```
   */
  async getStockBalance(options: BalanceOptions): Promise<StockBalance | null> {
    const { companyCode, itemCode, asOfDate } = options;

    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM get_stock_balance(
          ${companyCode}::VARCHAR(50),
          ${itemCode}::VARCHAR(50),
          ${asOfDate || null}::DATE
        )
      `;

      if (!result || result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        companyCode: row.company_code,
        itemCode: row.item_code,
        itemName: row.item_name,
        itemTypeCode: row.item_type_code,
        uom: row.uom,
        closingBalance: Number(row.closing_balance),
        snapshotDate: new Date(row.snapshot_date),
      };
    } catch (error) {
      this.log('Error getting stock balance', {
        error: error instanceof Error ? error.message : String(error),
        options,
      });
      throw new Error(
        `Failed to get stock balance: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate snapshot calculations for a specific date
   *
   * @param companyCode - Company code
   * @param targetDate - Date to validate
   * @returns Validation results
   */
  async validateSnapshot(companyCode: string, targetDate: Date): Promise<ValidationResult[]> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM validate_snapshot_calculation(
          ${companyCode}::VARCHAR(50),
          ${targetDate}::DATE
        )
      `;

      return result
        .filter((row) => row.issue_count > 0)
        .map((row) => ({
          validationType: row.validation_type,
          issueCount: row.issue_count,
          details: row.details,
        }));
    } catch (error) {
      this.log('Error validating snapshot', {
        error: error instanceof Error ? error.message : String(error),
        companyCode,
        targetDate: targetDate.toISOString(),
      });
      throw new Error(
        `Failed to validate snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get opening balance for an item
   *
   * @param companyCode - Company code
   * @param itemCode - Item code
   * @param targetDate - Date to get opening balance for
   * @returns Opening balance amount
   */
  async getOpeningBalance(
    companyCode: string,
    itemCode: string,
    targetDate: Date
  ): Promise<number> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT get_opening_balance(
          ${companyCode}::VARCHAR(50),
          ${itemCode}::VARCHAR(50),
          ${targetDate}::DATE
        ) AS opening_balance
      `;

      if (!result || result.length === 0) {
        return 0;
      }

      return Number(result[0].opening_balance);
    } catch (error) {
      this.log('Error getting opening balance', {
        error: error instanceof Error ? error.message : String(error),
        companyCode,
        itemCode,
        targetDate: targetDate.toISOString(),
      });
      throw new Error(
        `Failed to get opening balance: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate snapshot for multiple companies
   *
   * @param companyCodes - Array of company codes
   * @param targetDate - Date to calculate
   * @returns Array of calculation results
   */
  async calculateSnapshotForCompanies(
    companyCodes: string[],
    targetDate: Date
  ): Promise<Map<string, CalculationResult>> {
    const results = new Map<string, CalculationResult>();

    for (const companyCode of companyCodes) {
      try {
        const result = await this.calculateSnapshot({
          companyCode,
          targetDate,
        });
        results.set(companyCode, result);
      } catch (error) {
        this.log(`Error calculating snapshot for company ${companyCode}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other companies even if one fails
      }
    }

    return results;
  }

  /**
   * Check if snapshot exists for a date
   *
   * @param companyCode - Company code
   * @param targetDate - Date to check
   * @returns True if snapshot exists
   */
  async snapshotExists(companyCode: string, targetDate: Date): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<any[]>`
        SELECT EXISTS(
          SELECT 1 FROM stock_daily_snapshot
          WHERE company_code = ${companyCode}
            AND snapshot_date = ${targetDate}::DATE
        ) AS exists
      `;

      return result[0]?.exists === true;
    } catch (error) {
      this.log('Error checking snapshot existence', {
        error: error instanceof Error ? error.message : String(error),
        companyCode,
        targetDate: targetDate.toISOString(),
      });
      return false;
    }
  }

  // =====================================================================
  // Private Helper Methods
  // =====================================================================

  private parseValidationResults(jsonData: any): ValidationResult[] {
    if (!jsonData) {
      return [];
    }

    try {
      const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private log(message: string, data?: any): void {
    if (this.logger) {
      this.logger(message, data);
    }
  }
}

// =====================================================================
// Factory Function
// =====================================================================

/**
 * Create a new StockCalculationEngine instance
 *
 * @param prisma - Prisma client instance
 * @param logger - Optional logger function
 * @returns StockCalculationEngine instance
 *
 * @example
 * ```typescript
 * import { PrismaClient } from '@prisma/client';
 * import { createStockCalculationEngine } from '@/lib/stock-calculation/engine';
 *
 * const prisma = new PrismaClient();
 * const engine = createStockCalculationEngine(prisma, console.log);
 *
 * await engine.calculateSnapshot({
 *   companyCode: '1370',
 *   targetDate: new Date('2026-01-01')
 * });
 * ```
 */
export function createStockCalculationEngine(
  prisma: PrismaClient,
  logger?: (message: string, data?: any) => void
): StockCalculationEngine {
  return new StockCalculationEngine(prisma, logger);
}

// =====================================================================
// Singleton Instance (Optional)
// =====================================================================

let engineInstance: StockCalculationEngine | null = null;

/**
 * Get singleton instance of StockCalculationEngine
 *
 * @param prisma - Prisma client instance (required on first call)
 * @param logger - Optional logger function
 * @returns StockCalculationEngine singleton instance
 */
export function getStockCalculationEngine(
  prisma?: PrismaClient,
  logger?: (message: string, data?: any) => void
): StockCalculationEngine {
  if (!engineInstance) {
    if (!prisma) {
      throw new Error('Prisma client is required for first call to getStockCalculationEngine');
    }
    engineInstance = new StockCalculationEngine(prisma, logger);
  }
  return engineInstance;
}

export default StockCalculationEngine;
