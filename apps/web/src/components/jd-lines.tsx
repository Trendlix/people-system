import { jdBlocks } from '@/lib/jd-lines';

/** A job description's lines as HR typed them, with the bulleted points indented under their heading (lib/jd-lines.ts). */
export function JdLines({ lines }: { lines: readonly string[] }) {
  return (
    <div className="space-y-1">
      {jdBlocks(lines).map((block, i) =>
        block.kind === 'line' ? (
          <p key={i}>{block.text}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-10">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
