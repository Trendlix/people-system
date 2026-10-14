"""The order in which the lines found on a page are read."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Line:
    text: str
    confidence: float
    box: tuple[int, int, int, int]  # x_min, y_min, x_max, y_max, in pixels of the page

    @property
    def top(self) -> int:
        return self.box[1]

    @property
    def bottom(self) -> int:
        return self.box[3]

    @property
    def height(self) -> int:
        return max(self.box[3] - self.box[1], 1)


def reading_order(lines: list[Line], right_to_left: bool) -> list[Line]:
    """Top to bottom; within a row, right to left (Arabic) or left to right (English).

    Two lines are on the same row when they overlap vertically by at least half the height of the shorter one, which
    keeps a slightly tilted photo's rows together without merging rows that sit close. A row is compared by its average
    top and bottom, so a long row on a tilted photo does not drift into the next one.
    """
    rows: list[list[Line]] = []
    for line in sorted(lines, key=lambda line: (line.top + line.bottom) / 2):
        if rows and _same_row(rows[-1], line):
            rows[-1].append(line)
        else:
            rows.append([line])
    rows.sort(key=lambda row: sum(line.top + line.bottom for line in row) / len(row))

    ordered: list[Line] = []
    for row in rows:
        if right_to_left:
            ordered += sorted(row, key=lambda line: (-line.box[2], -line.box[0]))
        else:
            ordered += sorted(row, key=lambda line: (line.box[0], line.box[2]))
    return ordered


def _same_row(row: list[Line], line: Line) -> bool:
    top = sum(member.top for member in row) / len(row)
    bottom = sum(member.bottom for member in row) / len(row)
    overlap = min(bottom, line.bottom) - max(top, line.top)
    return overlap >= 0.5 * min(max(bottom - top, 1), line.height)
