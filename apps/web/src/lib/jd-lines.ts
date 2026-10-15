// A job description's lines as HR typed them (owner, 15 October 2026: "use the exact format of the job description
// added, just indent the points from the title"): nothing is numbered or reworded. A line starting with a bullet
// (•, ·, ▪, -, * …) is a point, shown indented under the line before it; any other line stays as it is.

export type JdBlock = { kind: 'line'; text: string } | { kind: 'points'; items: string[] };

const BULLET = /^\s*[•·▪◦‣●○\-*–—]\s*/;

/** The lines in blocks: points that follow each other form one indented list; other lines stand on their own. */
export function jdBlocks(lines: readonly string[]): JdBlock[] {
  const blocks: JdBlock[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = BULLET.exec(line);
    if (!bullet) {
      blocks.push({ kind: 'line', text: line });
      continue;
    }
    const text = line.slice(bullet[0].length).trim();
    if (!text) continue;
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'points') last.items.push(text);
    else blocks.push({ kind: 'points', items: [text] });
  }
  return blocks;
}
