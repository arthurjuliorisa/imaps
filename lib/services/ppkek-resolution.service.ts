import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

/**
 * Interface for PPKEK resolution result
 */
export interface ResolvedPPKEK {
  incoming_goods_id: number;
  ppkek_number: string;
  customs_registration_date: Date;
  customs_document_type: string;
  incoming_date: Date;
}

/**
 * PPKEK Resolution Service
 * 
 * Resolves PPKEK numbers (Product Identification & Customs Documentation Numbers) 
 * to incoming goods records using intelligent year-based matching logic.
 * 
 * Important: PPKEK numbers can reset annually, so the resolution logic must:
 * 1. First try to match in the SAME year as the outgoing date
 * 2. If not found, fall back to PREVIOUS years (most recent first)
 * 3. For each year, select the incoming record with date CLOSEST to outgoing date
 * 
 * Use Cases:
 * - Material Usage references incoming goods PPKEK
 * - Need to trace exported FG back to original incoming materials
 * - Customs compliance: link exports to imports by PPKEK
 */
export class PPKEKResolutionService {
  private logger = logger.child({
    service: 'PPKEKResolutionService',
  });

  /**
   * Resolve a single PPKEK number to incoming goods
   * 
   * RESOLUTION PRIORITY:
   * 1. Same year as outgoing_date → Closest incoming_date to outgoing_date
   * 2. Previous years (desc) → Closest incoming_date in most recent previous year
   * 3. Not found → Return null
   *
   * @param ppkekNumber - PPKEK number to resolve
   * @param itemCode - Item code (for logging & validation context)
   * @param companyCode - Company code for filtering
   * @param outgoingDate - Outgoing goods date (determines priority year)
   * @returns Resolved PPKEK with incoming goods details, or NULL if not found
   */
  async resolve(
    ppkekNumber: string,
    itemCode: string,
    companyCode: number,
    outgoingDate: Date
  ): Promise<ResolvedPPKEK | null> {
    const resolveLogger = this.logger.child({
      method: 'resolve',
      ppkekNumber,
      itemCode,
    });

    try {
      const outgoingYear = new Date(outgoingDate).getFullYear();

      // Query all incoming goods matching the PPKEK number
      const incomingCandidates = await prisma.incoming_goods.findMany({
        where: {
          ppkek_number: ppkekNumber,
          company_code: companyCode,
          deleted_at: null,
        },
        select: {
          id: true,
          ppkek_number: true,
          customs_registration_date: true,
          customs_document_type: true,
          incoming_date: true,
        },
        orderBy: {
          incoming_date: 'asc',
        },
      });

      if (incomingCandidates.length === 0) {
        resolveLogger.debug('No incoming goods found for PPKEK', {
          ppkekNumber,
          companyCode,
        });
        return null;
      }

      // ======================================================================
      // TIER 1: Same year as outgoing date
      // ======================================================================
      const sameYearMatch = incomingCandidates.find(
        (candidate) => new Date(candidate.incoming_date).getFullYear() === outgoingYear
      );

      if (sameYearMatch) {
        resolveLogger.debug('Resolved via Tier 1 (Same Year)', {
          incomingDate: sameYearMatch.incoming_date,
          outgoingYear,
        });
        return {
          incoming_goods_id: sameYearMatch.id,
          ppkek_number: sameYearMatch.ppkek_number,
          customs_registration_date: sameYearMatch.customs_registration_date,
          customs_document_type: sameYearMatch.customs_document_type,
          incoming_date: sameYearMatch.incoming_date,
        };
      }

      // ======================================================================
      // TIER 2: Previous years (descending year order)
      // ======================================================================
      // Group candidates by year and keep the one with closest date per year
      const groupedByYear = new Map<number, (typeof incomingCandidates)[0]>();

      for (const candidate of incomingCandidates) {
        const year = new Date(candidate.incoming_date).getFullYear();
        if (year < outgoingYear) {
          // Keep first (closest) from each year (already sorted by incoming_date asc)
          if (!groupedByYear.has(year)) {
            groupedByYear.set(year, candidate);
          }
        }
      }

      if (groupedByYear.size > 0) {
        // Select most recent previous year
        const yearsArray = Array.from(groupedByYear.keys()).sort((a, b) => b - a);
        const mostRecentYear = yearsArray[0];
        const previousYearMatch = groupedByYear.get(mostRecentYear)!;

        resolveLogger.debug('Resolved via Tier 2 (Previous Year)', {
          incomingDate: previousYearMatch.incoming_date,
          matchedYear: mostRecentYear,
          outgoingYear,
        });
        return {
          incoming_goods_id: previousYearMatch.id,
          ppkek_number: previousYearMatch.ppkek_number,
          customs_registration_date: previousYearMatch.customs_registration_date,
          customs_document_type: previousYearMatch.customs_document_type,
          incoming_date: previousYearMatch.incoming_date,
        };
      }

      // ======================================================================
      // TIER 3: No match found
      // ======================================================================
      resolveLogger.debug('No suitable match found in any tier', {
        candidateCount: incomingCandidates.length,
        outgoingYear,
      });
      return null;
    } catch (error) {
      resolveLogger.error('Error resolving PPKEK', { error });
      return null;
    }
  }

  /**
   * Batch resolve multiple PPKEK numbers
   * Optimized for resolving PPKEKs from material usage
   * 
   * @param ppkekNumbers - Array of PPKEK numbers to resolve
   * @param itemCode - Item code (for logging context)
   * @param companyCode - Company code
   * @param outgoingDate - Outgoing goods date
   * @returns Map of PPKEK -> ResolvedPPKEK or null
   */
  async resolveBatch(
    ppkekNumbers: string[],
    itemCode: string,
    companyCode: number,
    outgoingDate: Date
  ): Promise<Map<string, ResolvedPPKEK | null>> {
    const batchLogger = this.logger.child({
      method: 'resolveBatch',
      itemCount: ppkekNumbers.length,
    });

    batchLogger.info('Starting batch PPKEK resolution', { itemCount: ppkekNumbers.length });

    const results = new Map<string, ResolvedPPKEK | null>();

    for (const ppkek of ppkekNumbers) {
      const resolved = await this.resolve(ppkek, itemCode, companyCode, outgoingDate);
      results.set(ppkek, resolved);
    }

    const successCount = Array.from(results.values()).filter((v) => v !== null).length;
    batchLogger.info('Batch PPKEK resolution completed', {
      total: results.size,
      resolved: successCount,
      unresolved: results.size - successCount,
    });

    return results;
  }

  /**
   * Get all incoming goods for a PPKEK (for audit/debugging)
   * 
   * @param ppkekNumber - PPKEK number
   * @param companyCode - Company code
   * @returns Array of all matching incoming goods
   */
  async getAllMatchingIncomingGoods(
    ppkekNumber: string,
    companyCode: number
  ): Promise<ResolvedPPKEK[]> {
    const auditLogger = this.logger.child({
      method: 'getAllMatchingIncomingGoods',
      ppkekNumber,
    });

    try {
      const matches = await prisma.incoming_goods.findMany({
        where: {
          ppkek_number: ppkekNumber,
          company_code: companyCode,
          deleted_at: null,
        },
        select: {
          id: true,
          ppkek_number: true,
          customs_registration_date: true,
          customs_document_type: true,
          incoming_date: true,
        },
        orderBy: {
          incoming_date: 'desc',
        },
      });

      auditLogger.debug('Retrieved all matching incoming goods', {
        matchCount: matches.length,
      });

      return matches.map((m) => ({
        incoming_goods_id: m.id,
        ppkek_number: m.ppkek_number,
        customs_registration_date: m.customs_registration_date,
        customs_document_type: m.customs_document_type,
        incoming_date: m.incoming_date,
      }));
    } catch (error) {
      auditLogger.error('Error retrieving matching incoming goods', { error });
      return [];
    }
  }

  /**
   * Validate if a PPKEK can be resolved
   * Use before attempting resolution to fail fast
   * 
   * @param ppkekNumber - PPKEK number to validate
   * @param companyCode - Company code
   * @returns {canResolve: boolean, matchCount: number}
   */
  async canResolve(ppkekNumber: string, companyCode: number): Promise<{ canResolve: boolean; matchCount: number }> {
    try {
      const count = await prisma.incoming_goods.count({
        where: {
          ppkek_number: ppkekNumber,
          company_code: companyCode,
          deleted_at: null,
        },
      });

      return {
        canResolve: count > 0,
        matchCount: count,
      };
    } catch (error) {
      this.logger.error('Error checking if PPKEK can be resolved', { error });
      return {
        canResolve: false,
        matchCount: 0,
      };
    }
  }
}

// Export singleton instance
export const ppkekResolutionService = new PPKEKResolutionService();

/**
 * Legacy function-based API (for backward compatibility)
 * Prefer using PPKEKResolutionService class methods
 */
export async function resolvePPKEKToIncoming(
  ppkekNumber: string,
  itemCode: string,
  companyCode: number,
  outgoingDate: Date
): Promise<ResolvedPPKEK | null> {
  return ppkekResolutionService.resolve(ppkekNumber, itemCode, companyCode, outgoingDate);
}

/**
 * Legacy batch function (for backward compatibility)
 */
export async function resolvePPKEKBatch(
  ppkekNumbers: string[],
  itemCode: string,
  companyCode: number,
  outgoingDate: Date
): Promise<Map<string, ResolvedPPKEK | null>> {
  return ppkekResolutionService.resolveBatch(ppkekNumbers, itemCode, companyCode, outgoingDate);
}
