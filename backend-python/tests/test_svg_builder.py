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


def test_px_font_size():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Hello",
                    style=FlexNodeStyle(fontSize="48", fontWeight="700", color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'font-size="48"' in result.svg


def test_letter_spacing():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Hello",
                    style=FlexNodeStyle(fontSize="large", letterSpacing=3, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'letter-spacing="3"' in result.svg


def test_line_height_custom():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=200, text="Line one and line two test",
                    style=FlexNodeStyle(fontSize="medium", lineHeight=1.8, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=200))
    assert result.svg


def test_opacity():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Faded",
                    style=FlexNodeStyle(fontSize="large", opacity=0.5, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'opacity="0.5"' in result.svg


def test_border_radius_on_any_node():
    box = LayoutBox(id="badge", type="text", x=0, y=0, w=200, h=50, text="NEW",
                    style=FlexNodeStyle(fontSize="small", backgroundColor="#FF00FF",
                                        borderRadius=12, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=200, canvas_h=50))
    assert 'rx="12"' in result.svg


def test_text_shadow():
    box = LayoutBox(id="t", type="text", x=0, y=0, w=400, h=100, text="Shadow",
                    style=FlexNodeStyle(fontSize="large", textShadow="2px 2px 4px rgba(0,0,0,0.5)",
                                        color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=400, canvas_h=100))
    assert 'filter=' in result.svg


def test_max_lines():
    long_text = "Word " * 100
    box = LayoutBox(id="t", type="text", x=0, y=0, w=300, h=100, text=long_text,
                    style=FlexNodeStyle(fontSize="small", maxLines=2, color="#FFF"))
    result = build_flex_svg(FlexSVGInput(boxes=[box], canvas_w=300, canvas_h=100))
    tspan_count = result.svg.count("<tspan")
    assert tspan_count <= 2


def test_gradient_overlay():
    boxes = [
        LayoutBox(
            id="header", type="text", x=0, y=0, w=500, h=100,
            text="Hello",
            style=FlexNodeStyle(
                fontSize="large", color="#FFFFFF",
                gradientOverlay="to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)",
            ),
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
        bg_image_url="https://example.com/bg.jpg",
    ))
    assert "<linearGradient" in result.svg
    assert "stop-color" in result.svg
    assert "stop-opacity" in result.svg
