/** Minimal unified diff (LCS-based). Files we patch are small (manifests, configs). */

export function unifiedDiff(file: string, before: string, after: string, context = 3): string {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  type Op = { t: " " | "-" | "+"; line: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ t: " ", line: a[i]!, ai: i, bi: j });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      ops.push({ t: "+", line: b[j]!, ai: i, bi: j });
      j++;
    } else {
      ops.push({ t: "-", line: a[i]!, ai: i, bi: j });
      i++;
    }
  }

  const header = [`--- a/${file}`, `+++ b/${file}`];
  const out: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k]!.t === " ") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    // Extend the hunk while changes are within 2*context of each other.
    while (end < ops.length) {
      if (ops[end]!.t !== " ") {
        end++;
        continue;
      }
      let run = 0;
      while (end + run < ops.length && ops[end + run]!.t === " ") run++;
      if (end + run >= ops.length || run > context * 2) {
        end = Math.min(ops.length, end + Math.min(run, context));
        break;
      }
      end += run;
    }
    const hunk = ops.slice(start, end);
    const aStart = (hunk[0]?.ai ?? 0) + 1;
    const bStart = (hunk[0]?.bi ?? 0) + 1;
    const aLen = hunk.filter((o) => o.t !== "+").length;
    const bLen = hunk.filter((o) => o.t !== "-").length;
    out.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`);
    for (const o of hunk) out.push(`${o.t}${o.line}`);
    k = end;
  }
  return out.length ? [...header, ...out].join("\n") : "";
}
