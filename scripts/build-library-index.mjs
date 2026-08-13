import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const books = [
  { id: 'elliott', file: 'elliott-wave-principle-ru.pdf' },
  { id: 'wyckoff-method', file: 'wyckoff-method-hutson-ru.pdf' },
  { id: 'daytrader-bible', file: 'wyckoff-day-trader-bible-ru.pdf' },
];

function pageCount(pdfPath) {
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const match = info.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Could not read page count for ${pdfPath}`);
  return Number(match[1]);
}

function extractPages(pdfPath, expectedPages) {
  const raw = execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const extracted = raw.split('\f').slice(0, expectedPages);
  while (extracted.length < expectedPages) extracted.push('');
  return extracted.map((text, index) => ({
    page: index + 1,
    text: text.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim(),
  }));
}

const output = {
  version: 2,
  books: books.map((book) => {
    const pdfPath = join(root, 'assets', 'library', book.file);
    const pages = pageCount(pdfPath);
    return { id: book.id, pages, index: extractPages(pdfPath, pages) };
  }),
};

const outputPath = join(root, 'assets', 'library', 'search-index.json');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(output));

const totalPages = output.books.reduce((sum, book) => sum + book.pages, 0);
const bytes = readFileSync(outputPath).byteLength;
console.log(`Library index: ${output.books.length} books, ${totalPages} pages, ${bytes} bytes`);
