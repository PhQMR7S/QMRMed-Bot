import type { ContentKind } from '@prisma/client';
import { searchApprovedContent, type RetrievedContent } from './content-search.js';

export type SearchRequest = {
  query: string;
  kinds?: ContentKind[];
  department?: string;
  stage?: string;
  subjectName?: string;
  take?: number;
};

export type SearchResult = RetrievedContent & {
  score?: number;
  evidenceComplete?: boolean;
};

export interface SearchEngine {
  search(request: SearchRequest): Promise<SearchResult[]>;
}

/**
 * The default engine deliberately keeps the current PostgreSQL keyword retrieval
 * behavior. A semantic/vector implementation can replace this adapter later
 * without changing callers.
 */
export const keywordSearchEngine: SearchEngine = {
  async search(request) {
    return searchApprovedContent(request.query, request);
  },
};

export function assessEvidence(results: SearchResult[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery || results.length === 0) {
    return { sufficient: false, relevance: 0, coverage: 0, authority: 0 };
  }

  const queryTerms = normalizedQuery.split(/\s+/).filter((term) => term.length >= 2);
  const matchedTerms = new Set<string>();
  let relevantResults = 0;
  let authority = 0;

  for (const result of results) {
    const haystack = `${result.title} ${result.text}`.toLocaleLowerCase();
    let matches = 0;
    for (const term of queryTerms) {
      if (haystack.includes(term)) {
        matchedTerms.add(term);
        matches += 1;
      }
    }
    if (matches > 0) relevantResults += 1;
    if (result.webViewLink || result.driveFileId) authority += 1;
  }

  const relevance = relevantResults / results.length;
  const coverage = queryTerms.length ? matchedTerms.size / queryTerms.length : 0;
  const authorityScore = authority / results.length;
  return {
    sufficient: relevantResults > 0 && relevance >= 0.5 && (coverage >= 0.5 || queryTerms.length <= 1) && authorityScore >= 0.5,
    relevance,
    coverage,
    authority: authorityScore,
  };
}
