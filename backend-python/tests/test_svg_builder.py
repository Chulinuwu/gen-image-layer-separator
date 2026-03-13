from app.utils.svg_builder import build_flex_svg, FlexSVGInput
from app.utils.flex_layout import LayoutBox, FlexNodeStyle


def test_build_flex_svg_with_text_box():
    boxes = [LayoutBox(id="t1", type="text", x=100, y=100, w=400, h=200,
                       text="Hello", style=FlexNodeStyle(fontSize="large", color="#FFF"))]
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=1080, canvas_h=1080))
    assert "<svg" in result.svg
    assert "</svg>" in result.svg
    assert "Hello" in result.svg


def test_build_flex_svg_with_bg_image():
    result = build_flex_svg(FlexSVGInput(
        boxes=[], canvas_w=1080, canvas_h=1080,
        bg_image_url="http://localhost:5001/uploads/bg.png",
    ))
    assert "bg.png" in result.svg


def test_build_flex_svg_with_component():
    boxes = [LayoutBox(id="c1", type="component", x=0, y=0, w=500, h=500, label="mascot")]
    imgs = {"mascot": "http://localhost/img.png"}
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=1080, canvas_h=1080, component_images=imgs))
    assert "img.png" in result.svg
    assert 'data-role="component"' in result.svg


def test_build_flex_svg_empty_boxes():
    result = build_flex_svg(FlexSVGInput(boxes=[], canvas_w=1080, canvas_h=1080))
    assert "<svg" in result.svg
    assert "</svg>" in result.svg
    assert len(result.boxes) == 0


def test_build_flex_svg_escapes_xml():
    boxes = [LayoutBox(id="t1", type="text", x=0, y=0, w=500, h=200,
                       text="Price < 100 & Free", style=FlexNodeStyle(fontSize="medium", color="#FFF"))]
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=1080, canvas_h=1080))
    assert "&lt;" in result.svg
    assert "&amp;" in result.svg
