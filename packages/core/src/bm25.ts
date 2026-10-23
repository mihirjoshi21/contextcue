import { STOPWORDS } from './lexicon.js';

/** Lowercases, strips punctuation (keeping intra-word apostrophes), splits
 * on whitespace, and drops stopwords and single-character tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const K1 = 1.2;
const B = 0.75;

/**
 * A minimal, dependency-free Okapi BM25 index over a fixed corpus of
 * documents (one per subtitle cue), with k1=1.2, b=0.75 — the standard
 * defaults used by most search engines and IR textbooks.
 */
export class Bm25Index {
  private readonly docTokens: string[][];
  private readonly docLengths: number[];
  private readonly avgDocLength: number;
  private readonly documentFrequency: Map<string, number>;
  private readonly documentCount: number;

  constructor(documents: readonly string[]) {
    this.docTokens = documents.map((doc) => tokenize(doc));
    this.docLengths = this.docTokens.map((tokens) => tokens.length);
    this.documentCount = this.docTokens.length;
    const totalLength = this.docLengths.reduce((sum, len) => sum + len, 0);
    this.avgDocLength = this.documentCount > 0 ? totalLength / this.documentCount : 0;

    this.documentFrequency = new Map();
    for (const tokens of this.docTokens) {
      for (const term of new Set(tokens)) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  private idf(term: string): number {
    const n = this.documentFrequency.get(term) ?? 0;
    return Math.log(1 + (this.documentCount - n + 0.5) / (n + 0.5));
  }

  /** BM25 score of document `docIndex` against a raw (untokenized) query. */
  score(query: string, docIndex: number): number {
    const queryTerms = tokenize(query);
    const docTokens = this.docTokens[docIndex] ?? [];
    if (queryTerms.length === 0 || docTokens.length === 0) return 0;

    const termFrequency = new Map<string, number>();
    for (const term of docTokens) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    }

    const docLength = this.docLengths[docIndex] ?? 0;
    let total = 0;
    for (const term of queryTerms) {
      const freq = termFrequency.get(term) ?? 0;
      if (freq === 0) continue;
      const idf = this.idf(term);
      const numerator = freq * (K1 + 1);
      const denominator = freq + K1 * (1 - B + B * (docLength / (this.avgDocLength || 1)));
      total += idf * (numerator / denominator);
    }
    return total;
  }

  /** Scores every document in the corpus against `query`, in corpus order. */
  scoreAll(query: string): number[] {
    return this.docTokens.map((_, i) => this.score(query, i));
  }
}
