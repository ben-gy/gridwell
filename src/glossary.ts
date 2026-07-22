// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * Click-to-define tooltips.
 *
 * The audience is semi-technical by design: comfortable with a spreadsheet,
 * not necessarily with "columnar" or "Parquet". Rather than dumbing the
 * interface down, the jargon stays and every term is one click from a plain
 * definition.
 */

export const TERMS: Record<string, string> = {
  duckdb:
    'An analytical database engine built for scanning and aggregating large tables fast. Here it is compiled to WebAssembly and runs inside this browser tab — there is no database server anywhere.',
  webassembly:
    'A compact binary format that lets code written in languages like C++ run in a browser at close to native speed. It is how a real SQL engine fits in a web page.',
  parquet:
    'A compressed, columnar file format used across the data world. A Parquet file is typically 5–10× smaller than the same data as CSV and much faster to query.',
  columnar:
    'Storing values column-by-column instead of row-by-row. Summing one column then only has to read that column, which is why scans over millions of rows finish in milliseconds.',
  schema:
    'The list of columns in your data and the type of each one (text, number, date, and so on). Gridwell infers it by reading your file.',
  null: 'The absence of a value — distinct from zero or an empty string. Shown as a greyed NULL in the grid so it cannot be mistaken for real data.',
  sql: 'The standard language for querying tables. SELECT chooses columns, WHERE filters rows, ORDER BY sorts, LIMIT caps the count.',
  'zero-copy':
    'Reading data straight out of the memory the engine already produced, without converting it into a new format first. It is why results appear instantly even for wide tables.',
};

const TOOLTIP_ID = 'glossary-tooltip';

export function initGlossary(root: ParentNode = document): void {
  let tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.className = 'glossary-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);
  }
  const panel = tooltip;

  function hide(): void {
    panel.hidden = true;
  }

  root.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest?.(
      '.glossary-link',
    ) as HTMLElement | null;
    if (!link) {
      if (!panel.contains(event.target as Node)) hide();
      return;
    }

    const term = link.dataset.term?.toLowerCase() ?? '';
    const definition = TERMS[term];
    if (!definition) return;

    event.preventDefault();
    panel.textContent = definition;
    panel.hidden = false;

    // Positioned after unhiding so the measured height is real, and clamped so
    // a term near the right edge does not push the panel off screen.
    const rect = link.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const above = rect.top > panel.offsetHeight + 16;
    panel.style.left = `${left}px`;
    panel.style.top = above
      ? `${rect.top - panel.offsetHeight - 8}px`
      : `${rect.bottom + 8}px`;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', hide, true);
}
