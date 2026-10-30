// Minimal RFC 4180 CSV parser: quoted fields, "" escapes, commas and newlines inside
// quotes, CRLF or LF line endings, and a leading byte-order mark. Blank lines are skipped.
// Returns { rows: [{ line, cells }] } or throws CsvError with the line number.

export class CsvError extends Error {
  constructor(message, line) {
    super(`line ${line}: ${message}`);
    this.name = 'CsvError';
    this.line = line;
  }
}

export function parseCsv(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let cells = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let fieldStarted = false;

  const endField = () => {
    cells.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (!(cells.length === 1 && cells[0].trim() === '')) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (fieldStarted && field.trim() !== '') throw new CsvError('unexpected quote inside an unquoted field', line);
      field = '';
      quoted = true;
      fieldStarted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted) throw new CsvError('unterminated quoted field', rowLine);
  if (field !== '' || cells.length > 0) endRow();
  return { rows };
}
