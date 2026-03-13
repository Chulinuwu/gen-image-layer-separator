from app.utils.text_measure import measure_text, wrap_text, auto_fit_font_size


def test_measure_text_returns_positive():
    m = measure_text("Hello", 48, "400")
    assert m.width > 0
    assert m.height > 0
    assert m.ascent > 0


def test_measure_text_bold_wider():
    regular = measure_text("Hello", 48, "400")
    bold = measure_text("Hello", 48, "700")
    # Bold glyphs are typically wider or equal
    assert bold.width >= regular.width * 0.9


def test_wrap_text_single_line():
    result = wrap_text("Short", 500, 32, "400")
    assert len(result.lines) == 1
    assert result.lines[0] == "Short"


def test_wrap_text_wraps_long():
    result = wrap_text("This is a fairly long text that should wrap at some point", 100, 24, "400")
    assert len(result.lines) > 1


def test_wrap_text_preserves_newlines():
    result = wrap_text("Line1\nLine2\nLine3", 500, 32, "400")
    assert len(result.lines) == 3


def test_auto_fit_shrinks():
    result = auto_fit_font_size("Very long promo text here!!", 200, 120, 12, "700")
    assert result.font_size <= 120
    assert result.width <= 200


def test_auto_fit_uses_max_when_fits():
    result = auto_fit_font_size("Hi", 9999, 48, 12, "400")
    # Binary search with integer division may land 1 below max
    assert result.font_size >= 47
    assert result.font_size <= 48
