// Spreadsheet export. Cells that start with a character a spreadsheet treats as a formula are neutralised, so a
// client who typed "=HYPERLINK(...)" into the form can't make Nat's spreadsheet do anything when she opens the file.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
    const text = value === null || value === undefined ? '' : String(value);
    const safe = FORMULA_START.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
}

/** Rows joined with CRLF, every cell quoted, with a byte-order mark so Excel reads accented letters correctly. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
    return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Cents as plain spreadsheet numbers: 125050 becomes "1250.50". */
export function centsToNumber(cents: number): string {
    return (cents / 100).toFixed(2);
}
