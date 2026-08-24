const { SOURCES, fetchSource } = require("./dist-test/agent/sources.js");
const fs = require("fs");
const known = new Set(require("/tmp/coconala.json").map(l => l.url));
(async () => {
  const src = SOURCES.find(s => s.id === "coconala");
  const r = await fetchSource(src, { since: "", maxDetails: 140, delayMs: 1000, isKnown: (u) => known.has(u) });
  console.log(`新着 ${r.found} / 取得 ${r.fetched} / 失敗 ${r.failedPages} / 空 ${r.emptyPages} / 残り ${r.remaining}`);
  fs.writeFileSync("/tmp/coconala2.json", JSON.stringify(r.leads, null, 1));
})();
