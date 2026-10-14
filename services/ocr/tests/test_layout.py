from app.layout import reading_order

from .conftest import line


def texts(lines):
    return [item.text for item in lines]


def test_arabic_rows_are_read_right_to_left():
    found = [
        line("value", (100, 200, 300, 240)),
        line("label", (900, 205, 1100, 245)),
        line("title", (700, 50, 1100, 100)),
    ]
    assert texts(reading_order(found, right_to_left=True)) == ["title", "label", "value"]


def test_english_rows_are_read_left_to_right():
    found = [
        line("Salary: 25,000 EGP", (800, 400, 1200, 440)),
        line("Start date: 01/11/2026", (60, 402, 500, 442)),
        line("Employee: Ahmed", (60, 300, 600, 340)),
    ]
    assert texts(reading_order(found, right_to_left=False)) == [
        "Employee: Ahmed",
        "Start date: 01/11/2026",
        "Salary: 25,000 EGP",
    ]


def test_rows_go_top_to_bottom_whatever_order_they_come_in():
    found = [line(str(i), (0, 100 * i, 400, 100 * i + 40)) for i in (3, 0, 2, 1)]
    assert texts(reading_order(found, right_to_left=True)) == ["0", "1", "2", "3"]


def test_a_tilted_row_stays_one_row():
    # a phone photo taken at a slight angle: each item of the row sits a little lower than the one before
    found = [
        line("a", (0, 100, 200, 140)),
        line("b", (220, 112, 420, 152)),
        line("c", (440, 124, 640, 164)),
        line("next row", (0, 200, 200, 240)),
    ]
    assert texts(reading_order(found, right_to_left=False)) == ["a", "b", "c", "next row"]
    assert texts(reading_order(found, right_to_left=True)) == ["c", "b", "a", "next row"]


def test_rows_that_barely_touch_stay_apart():
    found = [line("lower", (0, 30, 100, 70)), line("upper", (300, 0, 400, 40))]  # 10 of 40 pixels overlap
    assert texts(reading_order(found, right_to_left=False)) == ["upper", "lower"]


def test_a_small_mark_inside_a_tall_line_joins_its_row():
    found = [line("tall", (500, 100, 900, 160)), line("dot", (300, 120, 320, 140))]
    assert texts(reading_order(found, right_to_left=True)) == ["tall", "dot"]


def test_no_lines():
    assert reading_order([], right_to_left=True) == []
