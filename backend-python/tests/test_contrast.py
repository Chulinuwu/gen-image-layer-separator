from app.utils.contrast import relative_luminance, contrast_ratio, check_text_contrast
from PIL import Image
import io


def test_relative_luminance_white():
    assert abs(relative_luminance(255, 255, 255) - 1.0) < 0.01


def test_relative_luminance_black():
    assert abs(relative_luminance(0, 0, 0) - 0.0) < 0.01


def test_contrast_ratio_black_on_white():
    ratio = contrast_ratio((255, 255, 255), (0, 0, 0))
    assert abs(ratio - 21.0) < 0.1


def test_contrast_ratio_same_color():
    ratio = contrast_ratio((128, 128, 128), (128, 128, 128))
    assert abs(ratio - 1.0) < 0.01


def test_check_text_contrast_good():
    img = Image.new("RGB", (200, 200), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    results = check_text_contrast(
        buf.getvalue(),
        [{"id": "h1", "x": 10, "y": 10, "w": 100, "h": 50, "color": "#FFFFFF"}],
    )
    assert results[0]["ratio"] >= 15.0
    assert results[0]["pass_aa"] is True


def test_check_text_contrast_poor():
    img = Image.new("RGB", (200, 200), (140, 140, 140))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    results = check_text_contrast(
        buf.getvalue(),
        [{"id": "h1", "x": 10, "y": 10, "w": 100, "h": 50, "color": "#999999"}],
    )
    assert results[0]["ratio"] < 3.0
    assert results[0]["pass_aa"] is False
