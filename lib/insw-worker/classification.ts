export type Classification = {
  kind: 'KNOWN_REMOTE_SUCCESS' | 'PERMANENT_FAILURE' | 'TRANSIENT_FAILURE' | 'DUPLICATE_POSSIBILITY' | 'UNKNOWN' | 'LOCAL_PREPARATION_FAILURE';
  reasonCode: string;
  retryCandidate: boolean;
};
const result = (kind: Classification['kind'], reasonCode: string, retryCandidate = false): Classification => ({ kind, reasonCode, retryCandidate });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Only ASCII whitespace is insignificant. Document case/punctuation are retained.
function documentId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500 || /[^\S\x20\t\r\n]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) return null;
  return value.trim().replace(/[ \t\r\n]+/g, ' ') || null;
}

// Actual transaction envelope, NOT a recursive search for similarly named keys.
// Multiple documents (even repeated identical IDs) cannot be resolved as one.
export function singleFrozenDocument(payload: unknown): string | null {
  const data = record(payload)?.data;
  if (!Array.isArray(data) || data.length !== 1) return null;
  const documents = record(data[0])?.dokumenKegiatan;
  if (!Array.isArray(documents) || documents.length !== 1) return null;
  return documentId(record(documents[0])?.nomorDokKegiatan);
}

export function classifyResponse(httpStatus: number, body: unknown, frozenPayload: unknown): Classification {
  const response = record(body);
  if (httpStatus >= 200 && httpStatus < 300 && response?.status === true) return result('KNOWN_REMOTE_SUCCESS', 'REMOTE_SUCCESS');
  // Contradictory responses never authorize retry or claim success.
  if (response?.status === true) return result('UNKNOWN', 'CONTRADICTORY_RESPONSE');
  // Numeric/coerced duplicate codes are ambiguous, never validated duplicates
  // or ordinary permanent validation failures.
  if (httpStatus === 400 && (response?.code === 2 || response?.code === '2')) return result('UNKNOWN', 'UNRECOGNIZED_CODE_02');
  if (httpStatus === 400 && response?.code === '02' && response.status === false) {
    const expected = singleFrozenDocument(frozenPayload);
    const message = response.message;
    const match = typeof message === 'string' && message.length <= 2000
      ? /^[ \t\r\n]*Atas[ \t\r\n]+nomor[ \t\r\n]+dokumen[ \t\r\n]+kegiatan[ \t\r\n]+([\s\S]+?)[ \t\r\n]+sudah[ \t\r\n]+pernah[ \t\r\n]+dikirim\.?[ \t\r\n]*$/i.exec(message) : null;
    if (expected && match && documentId(match[1]) === expected) return result('DUPLICATE_POSSIBILITY', 'DUPLICATE_POSSIBILITY');
    return result('UNKNOWN', 'UNRECOGNIZED_CODE_02');
  }
  if ([429, 500, 502, 503, 504].includes(httpStatus)) return result('TRANSIENT_FAILURE', 'TEMPORARY_UNAVAILABILITY', true);
  if ([401, 403].includes(httpStatus)) return result('PERMANENT_FAILURE', 'AUTHORIZATION_FAILURE');
  if (!response || typeof response.status !== 'boolean') return result('UNKNOWN', 'MALFORMED_RESPONSE');
  if (response.status === false && (httpStatus === 400 || httpStatus === 422 || (httpStatus >= 200 && httpStatus < 300))) {
    return result('PERMANENT_FAILURE', 'BUSINESS_VALIDATION_FAILURE');
  }
  return result('UNKNOWN', 'UNCLASSIFIED_RESPONSE');
}

export function classifyTransportFailure(reason: string, causeCode?: string): Classification {
  if (reason === 'TIMEOUT') return result('TRANSIENT_FAILURE', 'REQUEST_TIMEOUT', true);
  if (reason === 'CANCELLED') return result('UNKNOWN', 'REQUEST_CANCELLED');
  if (['EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(causeCode ?? '')) {
    return result('TRANSIENT_FAILURE', 'TEMPORARY_NETWORK_FAILURE', true);
  }
  return result('UNKNOWN', 'UNCLASSIFIED_TRANSPORT_FAILURE');
}

export function classifyLocalFailure(reason: 'DATA' | 'MAPPING' | 'SOURCE' | 'CONFIG' | 'AUTH' | 'DATABASE'): Classification {
  return reason === 'DATABASE' ? result('LOCAL_PREPARATION_FAILURE', 'LOCAL_DATABASE_PREPARATION_FAILURE')
    : result('PERMANENT_FAILURE', `LOCAL_${reason}_FAILURE`);
}
