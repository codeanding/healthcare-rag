import { Injectable } from '@nestjs/common';
import {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MIN_TOKENS,
  DEFAULT_OVERLAP_TOKENS,
  HEADING_MAX_LEN,
  HEADING_PATTERNS,
} from './ingestion.constants';
import type { Chunk, ChunkerOptions, PdfPage } from './ingestion.types';

@Injectable()
export class ChunkerService {
  chunk(text: string, pages: PdfPage[], options?: Partial<ChunkerOptions>): Chunk[] {
    const opts: ChunkerOptions = {
      maxTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      overlapTokens: options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS,
      minTokens: options?.minTokens ?? DEFAULT_MIN_TOKENS,
    };
    const maxChars = opts.maxTokens * CHARS_PER_TOKEN;
    const overlapChars = opts.overlapTokens * CHARS_PER_TOKEN;
    const minChars = opts.minTokens * CHARS_PER_TOKEN;

    const blocks = this.splitIntoBlocks(text);
    const chunks: { content: string; offset: number }[] = [];
    let buffer = '';
    let bufferOffset = 0;

    for (const block of blocks) {
      const candidate = buffer ? `${buffer}\n\n${block.content}` : block.content;

      if (candidate.length <= maxChars) {
        if (!buffer) bufferOffset = block.offset;
        buffer = candidate;
        continue;
      }

      // Buffer is full — flush it and start a new one with overlap.
      if (buffer.length > 0) {
        chunks.push({ content: buffer, offset: bufferOffset });
        const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
        buffer = `${tail}\n\n${block.content}`;
        bufferOffset = block.offset - tail.length;
      } else {
        buffer = block.content;
        bufferOffset = block.offset;
      }

      // If a single block is still over max, hard-split it.
      while (buffer.length > maxChars) {
        const slice = buffer.slice(0, maxChars);
        chunks.push({ content: slice, offset: bufferOffset });
        const tail = slice.slice(Math.max(0, slice.length - overlapChars));
        buffer = `${tail}${buffer.slice(maxChars)}`;
        bufferOffset = bufferOffset + maxChars - tail.length;
      }
    }

    if (buffer.length > 0) {
      chunks.push({ content: buffer, offset: bufferOffset });
    }

    return chunks
      .filter((c) => c.content.trim().length >= minChars)
      .map((c, i) => {
        const endOffset = c.offset + c.content.length;
        return {
          content: c.content.trim(),
          // Heading in effect at the end of the chunk: picks up a heading that
          // appears inside the chunk, falls back to the most recent heading
          // before the chunk if none.
          section: this.findSection(text, endOffset),
          // Attribute to the page that contains most of the chunk (use midpoint).
          pageNumber: this.findPageNumber(c.offset + Math.floor(c.content.length / 2), pages),
          chunkIndex: i,
        };
      });
  }

  // Splits text into paragraph- and table-sized blocks, preserving offsets so
  // later chunks can be attributed to a page.
  private splitIntoBlocks(text: string): Array<{ content: string; offset: number }> {
    const blocks: Array<{ content: string; offset: number }> = [];
    const paragraphs = text.split(/\n{2,}/);
    let cursor = 0;
    for (const paragraph of paragraphs) {
      const offset = text.indexOf(paragraph, cursor);
      cursor = offset + paragraph.length;
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) continue;
      blocks.push({ content: trimmed, offset });
    }
    return blocks;
  }

  private findSection(fullText: string, offset: number): string | null {
    const before = fullText.slice(0, offset).split('\n');
    for (let i = before.length - 1; i >= 0; i--) {
      const line = before[i]?.trim();
      if (!line) continue;
      if (line.length > HEADING_MAX_LEN) continue;
      if (HEADING_PATTERNS.some((p) => p.test(line))) {
        return line;
      }
    }
    return null;
  }

  private findPageNumber(offset: number, pages: PdfPage[]): number {
    for (const page of pages) {
      if (offset >= page.startOffset && offset < page.endOffset) {
        return page.pageNumber;
      }
    }
    return pages[pages.length - 1]?.pageNumber ?? 1;
  }
}
