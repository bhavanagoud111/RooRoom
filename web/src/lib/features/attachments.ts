import 'server-only';
import { HttpError } from '@/lib/auth';

// What may be shared in a study-buddy chat. The type comes from the file's own bytes and its
// extension together, never from what the browser claims, so a renamed program is refused.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type Rule = { type: string; inline?: boolean; check: (b: Buffer) => boolean };
const starts = (sig: number[], at = 0) => (b: Buffer) => sig.every((x, i) => b[at + i] === x);
const zip = starts([0x50, 0x4b, 0x03, 0x04]);
const ole = starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const text = (b: Buffer) => !b.includes(0) && Buffer.from(b.toString('utf8'), 'utf8').equals(b);

const RULES: Record<string, Rule> = {
  png: { type: 'image/png', inline: true, check: starts([0x89, 0x50, 0x4e, 0x47]) },
  jpg: { type: 'image/jpeg', inline: true, check: starts([0xff, 0xd8, 0xff]) },
  jpeg: { type: 'image/jpeg', inline: true, check: starts([0xff, 0xd8, 0xff]) },
  gif: { type: 'image/gif', inline: true, check: starts([0x47, 0x49, 0x46, 0x38]) },
  webp: { type: 'image/webp', inline: true, check: (b) => starts([0x52, 0x49, 0x46, 0x46])(b) && starts([0x57, 0x45, 0x42, 0x50], 8)(b) },
  pdf: { type: 'application/pdf', check: starts([0x25, 0x50, 0x44, 0x46, 0x2d]) },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: zip },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: zip },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: zip },
  doc: { type: 'application/msword', check: ole },
  xls: { type: 'application/vnd.ms-excel', check: ole },
  ppt: { type: 'application/vnd.ms-powerpoint', check: ole },
  zip: { type: 'application/zip', check: zip },
  txt: { type: 'text/plain', check: text },
  csv: { type: 'text/csv', check: text },
  md: { type: 'text/markdown', check: text },
};
export const ACCEPT = Object.keys(RULES).map((e) => `.${e}`).join(',');

export function checkAttachment(filename: string, buf: Buffer): { type: string; inline: boolean } {
  if (buf.length === 0) throw new HttpError(400, 'That file is empty.');
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new HttpError(400, 'Files up to 10 MB can be shared in chat.');
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const rule = RULES[ext];
  if (!rule) throw new HttpError(400, 'You can share images (PNG, JPG, GIF, WebP), PDFs, Word, Excel, PowerPoint, text, CSV and ZIP files.');
  if (!rule.check(buf)) throw new HttpError(400, `That file doesn’t look like a real .${ext} file.`);
  return { type: rule.type, inline: !!rule.inline };
}

export function isInlineImage(contentType: string) {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(contentType);
}
