import { writeFile } from 'node:fs/promises';

export async function writeJsonReport(report, filePath) {
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8');
  return filePath;
}
