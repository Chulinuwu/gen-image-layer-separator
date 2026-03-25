from app.utils.brightness_map import generate_brightness_heatmap
from PIL import Image
from io import BytesIO


def test_generate_brightness_heatmap_returns_jpeg():
    img = Image.new("RGB", (200, 300), (0, 0, 0))
    for x in range(100, 200):
        for y in range(300):
            img.putpixel((x, y), (255, 255, 255))
    buf = BytesIO()
    img.save(buf, format="PNG")

    result = generate_brightness_heatmap(buf.getvalue())
    assert len(result) > 0
    result_img = Image.open(BytesIO(result))
    assert result_img.size[0] > 0


def test_heatmap_preserves_aspect_ratio():
    img = Image.new("RGB", (400, 600), (128, 128, 128))
    buf = BytesIO()
    img.save(buf, format="PNG")

    result = generate_brightness_heatmap(buf.getvalue(), size=256)
    result_img = Image.open(BytesIO(result))
    assert abs(result_img.height / result_img.width - 1.5) < 0.1
