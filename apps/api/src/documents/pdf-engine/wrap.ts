// A text field that takes more than one line (owner, 16 October 2026: Form 1's qualification, "بكالوريوس التجارة -
// شعبة المحاسبة - جامعة طنطا", printed tiny on its one line). Its space is split into rows, from the bottom; the value
// wraps at its spaces in reading order, the first words on the top line it uses, the last ones on the bottom row (the
// form's dotted line). Only when it doesn't fit in all the rows is it made smaller, when the field shrinks to fit. Pure
// code: the widths are measured by the caller (fill.ts, with the fonts the PDF prints in).

/** How a value prints on its rows: its lines in reading order (the first one on top) and its size, in points. */
export interface WrappedText {
  lines: string[];
  size: number;
}

/** A width measured at 1 point: times the size for the width in points. */
export type Measure = (line: string) => number;

/**
 * The words a value wraps at: split at its spaces, a sign standing alone (the dash of "التجارة - شعبة") kept with the
 * word before it, so that no line starts with it.
 */
export function wrapUnits(text: string): string[] {
  const units: string[] = [];
  for (const word of text.split(' ').filter(Boolean)) {
    if (units.length && !/[\p{L}\p{N}]/u.test(word)) units[units.length - 1] += ` ${word}`;
    else units.push(word);
  }
  return units;
}

/**
 * The lines the units take filled one after another, each with as many as fit in `room` (a unit wider than `room` on a
 * line of its own); null once they need more than `max` lines. `width` is in the same terms as `room`.
 */
export function fillLines(units: readonly string[], width: (line: string) => number, room: number, max: number): string[] | null {
  const lines: string[] = [];
  for (const unit of units) {
    const longer = lines.length ? `${lines[lines.length - 1]} ${unit}` : null;
    if (longer !== null && width(longer) <= room) lines[lines.length - 1] = longer;
    else if (lines.push(unit) > max) return null;
  }
  return lines;
}

/**
 * The units on `count` lines (fewer when there are fewer units) as evenly as they go: the widest line as narrow as it
 * can be, for a value too long for its rows, which then sticks out of them as little as it can. The lines' widths are
 * taken as their units' and the spaces between them; on a tie, the top lines are the fuller.
 */
export function evenLines(units: readonly string[], width: Measure, count: number): string[] {
  const n = units.length;
  const k = Math.min(Math.max(1, Math.floor(count)), n);
  if (k <= 1) return n ? [units.join(' ')] : [];
  const widths = units.map(width);
  const space = Math.max(0, width(`${units[0]} ${units[1]}`) - widths[0] - widths[1]);
  const before = [0];
  widths.forEach((w, i) => before.push(before[i] + w));
  /** The width of units i to j - 1 on one line. */
  const span = (i: number, j: number) => before[j] - before[i] + (j - i - 1) * space;
  // widest[l][j]: the narrowest the widest line can be with the first j units on l lines; start[l][j]: where its last line starts
  const widest = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => Infinity));
  const start = Array.from({ length: k + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  widest[0][0] = 0;
  for (let l = 1; l <= k; l++) {
    for (let j = l; j <= n; j++) {
      for (let i = l - 1; i < j; i++) {
        const w = Math.max(widest[l - 1][i], span(i, j));
        if (w <= widest[l][j]) [widest[l][j], start[l][j]] = [w, i];
      }
    }
  }
  const lines: string[] = [];
  for (let l = k, j = n; l > 0; l--) {
    const i = start[l][j];
    lines.unshift(units.slice(i, j).join(' '));
    j = i;
  }
  return lines;
}

/**
 * How a value prints on `rows` rows `room` points wide: at `size` when it fits on them filled one after another;
 * else, when it may shrink, at the largest size at which it fits on all of them (never under `smallest`); else, or when
 * it doesn't fit even at `smallest`, spread over the rows as evenly as it goes (evenLines), the best it can.
 */
export function wrapText(
  text: string,
  options: { rows: number; room: number; size: number; shrink: boolean; smallest: number; width: Measure },
): WrappedText {
  const { rows, room, shrink, smallest, width } = options;
  const units = wrapUnits(text);
  /** The lines at a size, when they fit on the rows and each in the room. */
  const at = (size: number): string[] | null => {
    const lines = fillLines(units, (line) => width(line) * size, room, rows);
    return lines && lines.every((line) => width(line) * size <= room) ? lines : null;
  };
  let size = options.size;
  const fits = units.length ? at(size) : [];
  if (fits) return { lines: fits, size };
  if (shrink && size > smallest) {
    if (at(smallest)) {
      // the largest size that fits: fitting only gets easier as the size goes down
      let [lo, hi] = [smallest, size];
      for (let i = 0; i < 30 && hi - lo > 0.001; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid)) lo = mid;
        else hi = mid;
      }
      return { lines: at(lo)!, size: lo };
    }
    size = smallest;
  }
  return { lines: evenLines(units, width, rows), size };
}
