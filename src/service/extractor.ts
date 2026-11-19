/**
 * Adapter from Task A's extractor (`{ claims, claimsTruncated }`) to the check service's `ClaimExtractor`
 * (`{ claims, truncated }` plus a version used in report cache keys).
 */
import { extractClaims, extractClaimsFromText, type ExtractionResult } from '../core/claims/index';
import type { ClaimExtractor, ExtractedClaims } from './check';

/** Bump when extraction rules change so cached reports are not reused across versions. */
export const EXTRACTOR_VERSION = 'claims-v1';

function adapt(result: ExtractionResult): ExtractedClaims {
  return { claims: result.claims, truncated: result.claimsTruncated };
}

export function createClaimExtractor(): ClaimExtractor {
  return {
    version: EXTRACTOR_VERSION,
    extractClaims: (adf) => adapt(extractClaims(adf)),
    extractClaimsFromText: (text) => adapt(extractClaimsFromText(text)),
  };
}
