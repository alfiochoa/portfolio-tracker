The XML parts of `distribucion_agregada_cartera.xlsx` as exported on 2026-11-04, unzipped
unchanged except `workbook.xml`, trimmed to its `<sheets>` (the original also carries the
advisor's download path and Excel's revision ids). `tests/xlsx.test.ts` zips them back into a
workbook in memory. `portfolio.expected.json` is what `npm run import -- <that export> --date
2026-11-04` wrote: the committed `data/portfolio.json` of that day.
