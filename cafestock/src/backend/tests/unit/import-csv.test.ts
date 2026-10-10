import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/import/csv.js';

describe('parseCsv', () => {
  it('reads a simple comma-separated file', () => {
    const t = parseCsv('date,item,qty\n2025-01-01,Latte,3\n2025-01-02,Latte,4\n');
    expect(t.header).toEqual(['date', 'item', 'qty']);
    expect(t.rows).toEqual([
      ['2025-01-01', 'Latte', '3'],
      ['2025-01-02', 'Latte', '4'],
    ]);
    expect(t.lines).toEqual([2, 3]);
    expect(t.delimiter).toBe(',');
  });

  it('handles a BOM, CRLF line endings, blank lines and no final newline', () => {
    const t = parseCsv('﻿date,item,qty\r\n\r\n2025-01-01,Latte,3\r\n2025-01-02,Mocha,1');
    expect(t.header[0]).toBe('date');
    expect(t.rows).toHaveLength(2);
    expect(t.lines).toEqual([3, 4]);
  });

  it('handles quoted fields with commas, doubled quotes and line breaks', () => {
    const t = parseCsv('item,note\n"Milk, full cream","The ""good"" one"\n"Scone","two\nlines"\n');
    expect(t.rows).toEqual([
      ['Milk, full cream', 'The "good" one'],
      ['Scone', 'two\nlines'],
    ]);
  });

  it('detects semicolon and tab separators', () => {
    expect(parseCsv('date;item;qty\n01/02/2025;Latte;2,5\n').rows[0]).toEqual([
      '01/02/2025',
      'Latte',
      '2,5',
    ]);
    expect(parseCsv('date\titem\tqty\n2025-01-01\tLatte\t2\n').delimiter).toBe('\t');
  });

  it('pads short rows and allows empty trailing cells', () => {
    const t = parseCsv('a,b,c\n1,2\n1,2,3,,\n');
    expect(t.rows).toEqual([
      ['1', '2', ''],
      ['1', '2', '3'],
    ]);
  });

  it('explains rows with too many values', () => {
    expect(() => parseCsv('a,b\n1,2\n1,2,3\n')).toThrow(/Line 3 has 3 values but the header has 2/);
  });

  it('explains an unclosed quote', () => {
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(/quote.*line 2.*never closed/);
  });

  it('explains empty files', () => {
    expect(() => parseCsv('')).toThrow('The file is empty.');
    expect(() => parseCsv('a,b\n')).toThrow('no data rows');
  });
});
