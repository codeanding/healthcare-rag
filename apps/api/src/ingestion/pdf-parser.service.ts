import { Injectable } from '@nestjs/common';
import pdf from 'pdf-parse';
import type { ParsedPdf, PdfPage } from './ingestion.types';

@Injectable()
export class PdfParserService {
  async parse(buffer: Buffer, fallbackTitle: string): Promise<ParsedPdf> {
    const pages: PdfPage[] = [];
    let combined = '';
    let pageNumber = 0;

    const renderPage = async (pageData: {
      getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
    }): Promise<string> => {
      const { items } = await pageData.getTextContent();
      const pageText = items.map((i) => i.str).join(' ');
      pageNumber += 1;
      const startOffset = combined.length;
      combined += `${pageText}\n\n`;
      pages.push({ pageNumber, startOffset, endOffset: combined.length });
      return pageText;
    };

    const result = await pdf(buffer, { pagerender: renderPage });

    const titleFromMetadata = (result.info as { Title?: string } | undefined)?.Title?.trim() || '';
    const titleFromFirstLine =
      combined
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? '';

    return {
      text: combined.trim(),
      documentTitle: titleFromMetadata || titleFromFirstLine || fallbackTitle,
      pages,
    };
  }
}
