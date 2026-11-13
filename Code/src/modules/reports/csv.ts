/** CSV 1.0-safe field encoding. Integer money stays a plain digit string. */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function toCsv(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell)).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
