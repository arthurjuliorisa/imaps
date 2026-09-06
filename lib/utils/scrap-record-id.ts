export type ScrapRecordId = {
  source: 'scrap_transactions' | 'outgoing_goods';
  headerId: number;
  itemId: number;
};

/** Parse the stable, line-addressable IDs emitted by the Scrap list API. */
export function parseScrapRecordId(value: string): ScrapRecordId | null {
  const match = /^(SCRAP|OUTGOING)_(\d+)_(\d+)$/.exec(value);
  if (!match) return null;
  const headerId = Number(match[2]);
  const itemId = Number(match[3]);
  if (!Number.isSafeInteger(headerId) || !Number.isSafeInteger(itemId)) return null;
  return {
    source: match[1] === 'SCRAP' ? 'scrap_transactions' : 'outgoing_goods',
    headerId,
    itemId,
  };
}
