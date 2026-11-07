// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { looksScanned, pdfText } from './pdf';

describe('PDF text on the device (Task 4.10)', () => {
  it('reads the words of a text PDF, line by line', async () => {
    const buf = readFileSync('tests/fixtures/import/fixtures.pdf');
    const text = await pdfText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(text.split('\n')).toEqual([
      "St Vincent's GAA - Senior Football 2027",
      "Sat 6 March 2027 St Vincent's v Kilmacud Crokes 19:00 Marino",
      "Sun 14 March 2027 Ballyboden v St Vincent's 14:00 Ballyboden",
      "Sat 20 March 2027 St Vincent's v Na Fianna TBC Marino",
    ]);
    expect(looksScanned(text)).toBe(false);
  });

  it('a PDF with almost no text counts as scanned', () => {
    expect(looksScanned('  \n 1 ')).toBe(true);
  });
});
