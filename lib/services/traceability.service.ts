import { Prisma } from '@prisma/client';
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
 * Resolves PPKEK number to incoming goods with 3-tier year-based priority matching
 * 
 * PRIORITY LOGIC:
 * 1. Same year as outgoing date → Select closest incoming_date (ascending distance)
 * 2. Previous years (descending year order) → Select closest incoming_date for each year
 * 3. Return NULL if no match found
 *
 * @param ppkekNumber - PPKEK number to resolve
 * @param itemCode - Item code for validation
 * @param companyCode - Company code
 * @param outgoingDate - Outgoing goods date (used to determine priority year)
 * @returns Resolved PPKEK with incoming goods details, or NULL if not found
 */
export async function resolvePPKEKToIncoming(
  ppkekNumber: string,
  itemCode: string,
  companyCode: number,
  outgoingDate: Date
): Promise<ResolvedPPKEK | null> {
  try {
    const outgoingYear = new Date(outgoingDate).getFullYear();

    // Query incoming goods with matching PPKEK
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
      logger.debug(`[PPKEK Resolution] No incoming goods found for PPKEK: ${ppkekNumber}`);
      return null;
    }

    // Tier 1: Same year as outgoing date
    const sameYearMatch = incomingCandidates.find(
      (candidate: typeof incomingCandidates[0]) => new Date(candidate.incoming_date).getFullYear() === outgoingYear
    );

    if (sameYearMatch) {
      logger.debug(
        `[PPKEK Resolution] Tier 1 (Same Year) matched: PPKEK=${ppkekNumber}, IncomingDate=${sameYearMatch.incoming_date}`
      );
      return {
        incoming_goods_id: sameYearMatch.id,
        ppkek_number: sameYearMatch.ppkek_number,
        customs_registration_date: sameYearMatch.customs_registration_date,
        customs_document_type: sameYearMatch.customs_document_type,
        incoming_date: sameYearMatch.incoming_date,
      };
    }

    // Tier 2: Previous years (descending year order) → closest date in each year
    const groupedByYear = new Map<number, typeof incomingCandidates[0]>();

    for (const candidate of incomingCandidates) {
      const year = new Date(candidate.incoming_date).getFullYear();
      if (year < outgoingYear) {
        // Keep only the one with closest date (already sorted by incoming_date asc)
        if (!groupedByYear.has(year)) {
          groupedByYear.set(year, candidate);
        }
      }
    }

    if (groupedByYear.size > 0) {
      // Get the most recent year from previous years
      const yearsArray = Array.from(groupedByYear.keys()).sort((a, b) => b - a);
      const mostRecentYear = yearsArray[0];
      const previousYearMatch = groupedByYear.get(mostRecentYear)!;

      logger.debug(
        `[PPKEK Resolution] Tier 2 (Previous Year) matched: PPKEK=${ppkekNumber}, Year=${mostRecentYear}, IncomingDate=${previousYearMatch.incoming_date}`
      );
      return {
        incoming_goods_id: previousYearMatch.id,
        ppkek_number: previousYearMatch.ppkek_number,
        customs_registration_date: previousYearMatch.customs_registration_date,
        customs_document_type: previousYearMatch.customs_document_type,
        incoming_date: previousYearMatch.incoming_date,
      };
    }

    // Tier 3: No match found
    logger.debug(`[PPKEK Resolution] No suitable match in Tier 2 (Previous Years) for PPKEK: ${ppkekNumber}`);
    return null;
  } catch (error) {
    logger.error(`[PPKEK Resolution] Error resolving PPKEK: ${ppkekNumber}`, {
      error,
      itemCode,
      companyCode,
      outgoingDate,
    });
    return null;
  }
}

/**
 * Batch resolve multiple PPKEK numbers
 *
 * @param ppkekNumbers - Array of PPKEK numbers to resolve
 * @param itemCode - Item code
 * @param companyCode - Company code
 * @param outgoingDate - Outgoing goods date
 * @returns Map of PPKEK -> ResolvedPPKEK | null
 */
export async function resolvePPKEKBatch(
  ppkekNumbers: string[],
  itemCode: string,
  companyCode: number,
  outgoingDate: Date
): Promise<Map<string, ResolvedPPKEK | null>> {
  const results = new Map<string, ResolvedPPKEK | null>();

  for (const ppkek of ppkekNumbers) {
    const resolved = await resolvePPKEKToIncoming(ppkek, itemCode, companyCode, outgoingDate);
    results.set(ppkek, resolved);
  }

  return results;
}
