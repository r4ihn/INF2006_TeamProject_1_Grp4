import { ImportError } from './errors.js';

export interface CsvTable {
  /** Column names from the first line, trimmed */
  header: string[];
  /** Data rows, each padded to the header's length */
  rows: string[][];
  /** Line number (1-based, in the file) of each data row — for error messages */
  lines: number[];
  delimiter: ',' | ';' | '\t';
}

const DELIMITERS = [',', ';', '\t'] as const;

/** Picks the delimiter that appears most often in the header line (outside quotes). */
function detectDelimiter(text: string): CsvTable['delimiter'] {
  let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch as keyof typeof counts]++;
  }
  return DELIMITERS.reduce((best, d) => (counts[d] > counts[best] ? d : best), ',');
}

/**
 * Reads CSV text as saved by Excel, Google Sheets or pandas: quoted fields ("a, b"),
 * doubled quotes inside quotes, line breaks inside quotes, CRLF or LF, a UTF-8 BOM, and
 * comma, semicolon (European Excel) or tab separators. Blank lines are skipped.
 */
export function parseCsv(input: string): CsvTable {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const records: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    if (fields.some((f) => f.trim() !== '')) records.push({ fields, line: recordLine });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) {
    throw new ImportError(
      `The file has a quote (") on line ${quoteLine} that is never closed, so it can’t be read as CSV.`,
    );
  }
  if (field !== '' || fields.length > 0) endRecord();

  const [head, ...body] = records;
  if (!head) throw new ImportError('The file is empty.');
  const header = head.fields.map((h) => h.trim());
  if (body.length === 0) throw new ImportError('The file has a header row but no data rows.');

  const rows: string[][] = [];
  const lines: number[] = [];
  for (const r of body) {
    const extra = r.fields.slice(header.length);
    if (extra.some((f) => f.trim() !== '')) {
      throw new ImportError(
        `Line ${r.line} has ${r.fields.length} values but the header has ${header.length} columns. ` +
          `Check for an unquoted ${delimiter === ',' ? 'comma' : 'separator'} inside a value.`,
      );
    }
    const padded = r.fields.slice(0, header.length);
    while (padded.length < header.length) padded.push('');
    rows.push(padded);
    lines.push(r.line);
  }
  return { header, rows, lines, delimiter };
}
