export type ScrapTransactionListView = 'summary' | 'detail';

/**
 * Selects the rows to paginate after the list query has assembled its combined
 * active item rows. Summary deduplicates document headers in an inner query so
 * the caller can apply one final, deterministic order and pagination clause.
 */
export function buildScrapTransactionListProjection(view: ScrapTransactionListView): string {
  return view === 'summary'
    ? `SELECT * FROM (
         SELECT DISTINCT ON (transaction_type, source_id) *
         FROM combined
         ORDER BY transaction_type, source_id, sort_date DESC, record_id DESC
       ) summary_rows`
    : 'SELECT * FROM combined';
}
