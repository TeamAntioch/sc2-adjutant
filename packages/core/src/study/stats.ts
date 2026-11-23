/** Small numeric helpers shared by Map Study measures. Values are rounded for readable JSON. */

export function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function quantiles(values: readonly number[]): { min: number; p25: number; p50: number; p75: number; p90: number; max: number; mean: number } {
  if (values.length === 0) return { min: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { min: round(sorted[0]!), p25: round(at(0.25)), p50: round(at(0.5)), p75: round(at(0.75)), p90: round(at(0.9)), max: round(sorted.at(-1)!), mean: round(mean) };
}

export function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

export function topEntries(counts: Map<string, number>, n: number, total?: number): { name: string; count: number; share?: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => (total ? { name, count, share: round(count / total) } : { name, count }));
}
