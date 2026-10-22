import { createRequire } from 'node:module';

const katex = createRequire(process.env.BOTAI_KATEX_PACKAGE)('katex');

const batchMode = process.env.BOTAI_KATEX_BATCH === 'true';
const chunks = [];
let inputBytes = 0;
for await (const chunk of process.stdin) {
  inputBytes += chunk.length;
  if (inputBytes > (batchMode ? 65_536 : 16_000)) process.exit(1);
  chunks.push(chunk);
}
const value = Buffer.concat(chunks).toString('utf8');
try {
  const formulas = batchMode ? JSON.parse(value) : [{ value, displayMode: process.env.BOTAI_KATEX_DISPLAY_MODE === 'true' }];
  if (!Array.isArray(formulas) || formulas.length < 1 || formulas.length > 128) process.exit(1);
  for (const formula of formulas) {
    if (!formula || Object.keys(formula).sort().join(',') !== 'displayMode,value' || typeof formula.value !== 'string' || typeof formula.displayMode !== 'boolean' || !formula.value.length || formula.value.length > 4000 || Buffer.byteLength(formula.value, 'utf8') > 16_000) process.exit(1);
    if (/\\(?:href|url|html\w*|includegraphics|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global|csname|input|include|write|openout|read|catcode)\b/.test(formula.value)) process.exit(1);
    katex.renderToString(formula.value, { displayMode: formula.displayMode, trust: false, throwOnError: true, strict: 'error', maxExpand: 1000, maxSize: 10, macros: {} });
  }
} catch {
  process.exit(1);
}
