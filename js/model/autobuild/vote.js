// vote.js
// Voting over the several OCR reads of one label. Pure.
import { repairNumber } from './grammar.js';
import { matchName } from './vocab.js';

// reads: [{ text, conf }] for ONE label. opts: { format } (from inferFormat).
// -> array of number candidates ranked best first: [{ val, n, cost, conf, score }]
//    (same fields the pipeline's inline vote produces: val, n votes, summed cost, best conf)
//    score in 0..1 = share of reads agreeing x cheapness x confidence; `weak` when only format-guessed.
//    The array also carries .names ([{ name, n }] best first; only reads that are not numbers),
//    .total (reads counted) and .weak (best candidate is weak).
export function voteReads(reads, opts = {}) {
  const votes = new Map();
  const nameVotes = new Map();
  let total = 0;
  for (const rd of reads || []) {
    const text = (rd && rd.text) || '';
    total++;
    const tokens = text.split(/\s+/).filter(Boolean);
    for (const tk of tokens.length > 1 ? [text, ...tokens] : tokens) {
      const r = repairNumber(tk, opts.format);
      if (!r) continue;
      const v = votes.get(r.value) || { n: 0, cost: 0, conf: 0, weak: true };
      v.n++; v.cost += r.cost; v.conf = Math.max(v.conf, rd.conf || 0); v.weak = v.weak && !!r.weak;
      votes.set(r.value, v);
    }
    const nm = matchName(text);
    if (nm && !repairNumber(text, opts.format)) nameVotes.set(nm, (nameVotes.get(nm) || 0) + 1);
  }
  const ranked = [...votes].map(([val, v]) => {
    const avgCost = v.cost / v.n;
    const score = Math.max(0, Math.min(1, (v.n / Math.max(1, total)) * (1 / (1 + avgCost * 0.35)) * (0.5 + 0.5 * Math.min(1, v.conf / 90)) * (v.weak ? 0.6 : 1)));
    return { val, ...v, score };
  }).sort((a, b) => b.n - a.n || a.cost - b.cost);
  ranked.names = [...nameVotes].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  ranked.total = total;
  ranked.weak = !!(ranked[0] && ranked[0].weak);
  return ranked;
}
