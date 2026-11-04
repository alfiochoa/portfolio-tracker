// The fund catalogue, the allocation, and the maths on weights. Pure: no DOM, no I/O.

export type Kind = 'equity' | 'bond';

export interface Fund {
  id: string;
  /** The name as the advisor's export spells it: the match key, character for character. */
  name: string;
  shortName: string;
  /** null until T-002 has verified it against two public sources. */
  isin: string | null;
  kind: Kind;
  assetClass: { es: string; en: string };
  sources: Record<string, string>;
}

export interface Portfolio {
  /** The day the export was made, YYYY-MM-DD. */
  anchorDate: string;
  sourceFile: string;
  /** Fractions of the invested total, unrounded, summing to 1. */
  positions: { fund: string; weight: number }[];
}

export interface Position {
  fund: Fund;
  weight: number;
}

export interface AssetClassWeight {
  /** English name, for the screen. */
  name: string;
  /** Spanish name, as exported. */
  nameEs: string;
  kind: Kind;
  weight: number;
}

export interface Allocation {
  total: number;
  equities: number;
  bonds: number;
  byAssetClass: AssetClassWeight[];
}

/** Heaviest first; equal weights fall back to the short name so the order is stable. */
const byWeightDesc = <T extends { weight: number }>(key: (x: T) => string) =>
  (a: T, b: T): number => b.weight - a.weight || key(a).localeCompare(key(b));

/** Join the allocation to the catalogue, one row per fund, sorted by weight descending. */
export function positionsOf(funds: readonly Fund[], portfolio: Portfolio): Position[] {
  const catalogue = new Map(funds.map((f) => [f.id, f]));
  return portfolio.positions
    .map(({ fund: id, weight }) => {
      const fund = catalogue.get(id);
      if (!fund) throw new Error(`portfolio.json names fund "${id}", which is not in funds.json`);
      return { fund, weight };
    })
    .sort(byWeightDesc((p) => p.fund.shortName));
}

export function totalWeight(positions: readonly { weight: number }[]): number {
  return positions.reduce((sum, p) => sum + p.weight, 0);
}

/** Equities against bonds, and the weight of each asset class, heaviest first. */
export function allocationOf(positions: readonly Position[]): Allocation {
  const classes = new Map<string, AssetClassWeight>();
  for (const { fund, weight } of positions) {
    const key = fund.assetClass.en;
    const entry = classes.get(key);
    if (entry) entry.weight += weight;
    else classes.set(key, { name: key, nameEs: fund.assetClass.es, kind: fund.kind, weight });
  }
  const ofKind = (kind: Kind) => totalWeight(positions.filter((p) => p.fund.kind === kind));
  return {
    total: totalWeight(positions),
    equities: ofKind('equity'),
    bonds: ofKind('bond'),
    byAssetClass: [...classes.values()].sort(byWeightDesc((c) => c.name)),
  };
}
