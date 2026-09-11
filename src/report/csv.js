import { writeFile } from 'node:fs/promises';

function escapeCsv(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function writeCsvReport(report, filePath) {
  const headers = ['category', 'severity', 'title', 'description', 'recommendation', 'url'];
  const rows = [headers.join(',')];
  for (const iss of report.issues) {
    rows.push(headers.map((h) => escapeCsv(iss[h])).join(','));
  }
  await writeFile(filePath, rows.join('\n'), 'utf-8');
  return filePath;
}
