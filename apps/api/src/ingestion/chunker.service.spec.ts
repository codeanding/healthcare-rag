import { describe, expect, it } from 'vitest';
import { ChunkerService } from './chunker.service';
import type { PdfPage } from './ingestion.types';

const singlePage: PdfPage[] = [{ pageNumber: 1, startOffset: 0, endOffset: 100_000 }];

describe('ChunkerService', () => {
  const chunker = new ChunkerService();

  it('returns a single chunk for short text', () => {
    const text = 'This is a short clinical note about dosage.';
    const chunks = chunker.chunk(text, singlePage, { minTokens: 5 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(text);
    expect(chunks[0]?.pageNumber).toBe(1);
  });

  it('discards chunks below the minimum token threshold', () => {
    const text = 'tiny';
    const chunks = chunker.chunk(text, singlePage, { minTokens: 50 });
    expect(chunks).toHaveLength(0);
  });

  it('splits long text into multiple chunks with overlap', () => {
    const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20);
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunker.chunk(text, singlePage, {
      maxTokens: 100,
      overlapTokens: 20,
      minTokens: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Adjacent chunks should share overlapping tail text.
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1]!.content.slice(-40);
      const currentHead = chunks[i]!.content.slice(0, 200);
      expect(currentHead).toContain(prevTail.slice(0, 20));
    }
  });

  it('attributes the closest preceding heading as the section', () => {
    const text = `INTRODUCTION\n\nSome introductory clinical text describing the protocol.\n\nDOSAGE\n\nAdminister 5mg per kilogram every six hours for adult patients.`;
    const chunks = chunker.chunk(text, singlePage, {
      maxTokens: 30,
      overlapTokens: 5,
      minTokens: 5,
    });
    const dosageChunk = chunks.find((c) => c.content.includes('5mg'));
    expect(dosageChunk?.section).toBe('DOSAGE');
  });

  it('uses correct page number based on offsets', () => {
    const pageOne = 'Page one content.\n\n';
    const pageTwo = 'Page two content describing dosage details.';
    const text = pageOne + pageTwo;
    const pages: PdfPage[] = [
      { pageNumber: 1, startOffset: 0, endOffset: pageOne.length },
      { pageNumber: 2, startOffset: pageOne.length, endOffset: text.length },
    ];
    const chunks = chunker.chunk(text, pages, { minTokens: 3 });
    const dosageChunk = chunks.find((c) => c.content.includes('dosage'));
    expect(dosageChunk?.pageNumber).toBe(2);
  });
});
