/** Writes one Word document holding every control family's SOP section, from the bundled template. */
import fs from 'node:fs/promises';
import type { SopExportRequest } from '../shared/types.js';
import { composeSopDocumentData, type SopContentFile } from '../shared/sop.js';
import { renderSopDocx } from '../shared/sopRender.js';
import { bundledCatalogFile } from './storage.js';

export async function writeSopDocument(req: SopExportRequest, file: string): Promise<void> {
  const template = await fs.readFile(bundledCatalogFile('sop-family-template.docx'));
  const content = JSON.parse(await fs.readFile(bundledCatalogFile('sop-family-content.json'), 'utf8')) as SopContentFile;
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  await fs.writeFile(file, renderSopDocx(template, composeSopDocumentData(req.families, content, exportDate)));
}
