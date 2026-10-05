import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/** Formats that are already compressed; deflating them again only costs time. */
const STORED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.docx', '.xlsx', '.pptx', '.zip', '.gz', '.7z']);

export type ZipEntry = { name: string; data: Buffer } | { name: string; path: string };

/** Streams entries into a ZIP at `target`, reading one file into memory at a time. */
export async function writeZip(target: string, entries: ZipEntry[]): Promise<void> {
  const out = createWriteStream(target);
  const finished = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });

  let zipError: Error | null = null;
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      out.destroy(err);
      return;
    }
    out.write(chunk);
    if (final) out.end();
  });

  try {
    for (const entry of entries) {
      const data = 'data' in entry ? entry.data : await fs.readFile(entry.path);
      const file = STORED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ? new ZipPassThrough(entry.name)
        : new ZipDeflate(entry.name, { level: 6 });
      zip.add(file);
      file.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), true);
      if (zipError) throw zipError;
    }
    zip.end();
  } catch (error) {
    zip.terminate();
    out.destroy();
    await fs.rm(target, { force: true });
    throw error;
  }
  await finished;
}
