// bridge.js
// Closes the gaps in straight wall lines (door openings, breaks where a wall was drawn in two pieces) WITHOUT
// thickening anything: along each row and column, two ink runs that point at each other across a gap of at most
// `gap` px are joined. Parallel walls close together are untouched (nothing is added sideways), so a room that
// was open on one side becomes a closed cell while neighbouring rooms stay separate. Pure.
// Depends on: nothing.

// ink: Uint8Array 0/1 (w*h). minRun: shortest ink run (px) that counts as a wall piece. -> new Uint8Array (ink + bridges)
export function bridgeGaps(ink, w, h, gap, minRun = Math.max(6, gap)) {
  const out = ink.slice();
  const pass = (alongX) => {
    const P = alongX ? h : w, A = alongX ? w : h;
    for (let p = 0; p < P; p++) {
      let a = 0;
      const at = (k) => ink[alongX ? p * w + k : k * w + p];
      const runs = [];
      while (a < A) {
        if (!at(a)) { a++; continue; }
        let b = a;
        while (b < A && at(b)) b++;
        runs.push([a, b - 1]);
        a = b;
      }
      for (let i = 0; i + 1 < runs.length; i++) {
        const [s0, e0] = runs[i], [s1, e1] = runs[i + 1];
        const g = s1 - e0 - 1;
        if (g < 1 || g > gap) continue;
        if (e0 - s0 + 1 < minRun || e1 - s1 + 1 < minRun) continue;
        for (let k = e0 + 1; k < s1; k++) out[alongX ? p * w + k : k * w + p] = 1;
      }
    }
  };
  pass(true);
  pass(false);
  return out;
}
