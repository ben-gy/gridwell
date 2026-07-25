// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * A synthetic dataset so the tool can be tried without a file of your own.
 *
 * Generated in the browser rather than committed as a binary: it keeps the
 * repo lean, and — like everything else here — it never touches a server. The
 * generator is deterministic (a fixed seed), so the example is the same on
 * every visit and the test suite can pin its shape exactly. The columns are
 * chosen to exercise the things Gridwell is for: a date to sort on, a couple of
 * categoricals to filter by, integers and floats to aggregate, and a boolean.
 */

export const EXAMPLE_FILE_NAME = 'example-orders.csv';

/** Rows of synthetic data. Enough to feel real and to time a scan against; small enough to build instantly. */
const EXAMPLE_ROWS = 5000;

const REGIONS = ['North', 'South', 'East', 'West', 'Central'] as const;
const CHANNELS = ['Online', 'Retail', 'Wholesale', 'Partner'] as const;
const PRODUCTS = [
  ['Aurora Desk Lamp', 'Lighting', 48.0],
  ['Basalt Mug', 'Kitchen', 14.5],
  ['Cirrus Notebook', 'Stationery', 9.0],
  ['Delta Backpack', 'Travel', 79.0],
  ['Ember Kettle', 'Kitchen', 39.5],
  ['Fjord Water Bottle', 'Travel', 22.0],
  ['Grove Planter', 'Garden', 18.0],
  ['Harbor Umbrella', 'Outdoor', 27.5],
  ['Indigo Throw', 'Home', 55.0],
  ['Juniper Candle', 'Home', 12.0],
] as const;

/**
 * A tiny deterministic PRNG (mulberry32). Not cryptographic — it only needs to
 * be repeatable and evenly spread so the example never changes between visits.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** ISO date `days` after 2025-01-01, without pulling in a date library or touching the clock. */
function isoDate(days: number): string {
  const base = Date.UTC(2025, 0, 1);
  const d = new Date(base + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** CSV-quote a field only when it needs it, matching what a real export would produce. */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const EXAMPLE_COLUMNS = [
  'order_id',
  'order_date',
  'region',
  'channel',
  'product',
  'category',
  'units',
  'unit_price',
  'revenue',
  'returned',
] as const;

/**
 * Build the example CSV as text. Deterministic for a given seed, so the same
 * dataset appears every time and the tests can assert on exact values.
 */
export function buildExampleCsv(rows: number = EXAMPLE_ROWS, seed = 0x9e3779b9): string {
  const rand = mulberry32(seed);
  const lines: string[] = [EXAMPLE_COLUMNS.join(',')];

  for (let i = 0; i < rows; i++) {
    const [product, category, price] = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
    const region = REGIONS[Math.floor(rand() * REGIONS.length)];
    const channel = CHANNELS[Math.floor(rand() * CHANNELS.length)];
    const units = 1 + Math.floor(rand() * 12);
    const revenue = Math.round(units * (price as number) * 100) / 100;
    // A minority of orders come back — enough to make a WHERE returned = true interesting.
    const returned = rand() < 0.08;

    lines.push(
      [
        String(100_000 + i),
        isoDate(Math.floor(rand() * 365)),
        region,
        channel,
        csvField(product as string),
        category as string,
        String(units),
        (price as number).toFixed(2),
        revenue.toFixed(2),
        returned ? 'true' : 'false',
      ].join(','),
    );
  }

  return lines.join('\n') + '\n';
}

/** The example wrapped as a `File`, ready to hand to the same code path a dropped file takes. */
export function exampleFile(): File {
  return new File([buildExampleCsv()], EXAMPLE_FILE_NAME, { type: 'text/csv' });
}
