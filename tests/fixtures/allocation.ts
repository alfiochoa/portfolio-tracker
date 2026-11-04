// Literal fixtures: three funds of the real catalogue's shape, weights written out, deliberately unsorted.
import type { Fund, Portfolio } from '../../src/lib/portfolio.ts';

const fund = (id: string, shortName: string, kind: Fund['kind'], en: string, es: string): Fund => ({
  id,
  name: `Vanguard ${shortName} Index Euro - Institutional Plus`,
  shortName,
  isin: null,
  kind,
  assetClass: { es, en },
  sources: { yahoo: `${id.toUpperCase()}.F` },
});

export const funds: Fund[] = [
  fund('japan', 'Japan Stock', 'equity', 'Japanese equities', 'Acciones Japón'),
  fund('eurogov', 'Euro Government Bond', 'bond', 'Euro government bonds', 'Bonos gobiernos europeos'),
  fund('us500', 'US 500', 'equity', 'US equities', 'Acciones Estados Unidos'),
  fund('euroinfl', 'Eurozone Inflation-Linked Bond', 'bond', 'Euro inflation-linked bonds', 'Bonos europeos ligados a la inflación'),
];

export const portfolio: Portfolio = {
  anchorDate: '2026-11-04',
  sourceFile: 'distribucion_agregada_cartera.xlsx',
  positions: [
    { fund: 'eurogov', weight: 0.15 },
    { fund: 'us500', weight: 0.6 },
    { fund: 'euroinfl', weight: 0.05 },
    { fund: 'japan', weight: 0.2 },
  ],
};
