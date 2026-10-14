// Which of the cards found on the uploaded scans is the front of the national ID, and which the back.

export interface FoundCard {
  side: 'front' | 'back' | null; // as the OCR service recognised it
  confidence: number;
  file: number; // 0: the file sent as the front, 1: the file sent as the back
}

/**
 * The front and the back: the card recognised as each side (the most confident one), otherwise by the files they
 * came in (with two files, the first holds the front), otherwise in the order found. Either can be missing.
 */
export function assignSides<T extends FoundCard>(cards: T[], files: number): [T | null, T | null] {
  const best = (side: 'front' | 'back') => cards.filter((c) => c.side === side).sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  let front = best('front');
  let back = best('back');
  const rest = () => cards.filter((c) => c !== front && c !== back);
  if (!front) front = (files === 2 ? rest().find((c) => c.file === 0) : undefined) ?? rest()[0] ?? null;
  if (!back) back = (files === 2 ? rest().find((c) => c.file === 1) : undefined) ?? rest()[0] ?? null;
  return [front, back];
}
