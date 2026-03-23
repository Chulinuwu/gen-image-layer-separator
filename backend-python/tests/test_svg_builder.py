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


def test_component_drop_shadow():
    boxes = [
        LayoutBox(
            id="product", type="component", x=100, y=100, w=200, h=200,
            label="phone",
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
        component_images={"phone": "https://example.com/phone.png"},
    ))
    assert "comp-shadow" in result.svg
    assert "feDropShadow" in result.svg
    assert 'filter="url(#comp-shadow' in result.svg


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


def test_multi_layer_shadow():
    boxes = [
        LayoutBox(
            id="glow-text", type="text", x=0, y=0, w=500, h=100,
            text="Glow",
            style=FlexNodeStyle(
                fontSize="large", color="#FFFFFF",
                textShadow="0px 0px 8px rgba(255,215,0,0.8), 0px 2px 4px rgba(0,0,0,0.5)",
            ),
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
    ))
    assert result.svg.count("feDropShadow") == 2


def test_glow_shadow():
    boxes = [
        LayoutBox(
            id="glow", type="text", x=0, y=0, w=500, h=100,
            text="Glow",
            style=FlexNodeStyle(
                fontSize="large", color="#FFFFFF",
                textShadow="0px 0px 12px rgba(255,255,255,0.6)",
            ),
        )
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
    ))
    assert "feDropShadow" in result.svg
    assert 'stdDeviation="12"' in result.svg


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


def test_full_quality_features():
    """All visual quality features render together without conflict."""
    boxes = [
        LayoutBox(
            id="bg-fade", type="text", x=0, y=300, w=500, h=200,
            text="",
            style=FlexNodeStyle(
                gradientOverlay="to-bottom rgba(0,0,0,0) rgba(0,0,0,0.7)",
            ),
        ),
        LayoutBox(
            id="headline", type="text", x=50, y=50, w=400, h=80,
            text="Big Sale",
            style=FlexNodeStyle(
                fontSize="xlarge", color="#FFFFFF", fontWeight="900",
                textShadow="0px 0px 10px rgba(255,215,0,0.6), 2px 2px 4px rgba(0,0,0,0.5)",
            ),
        ),
        LayoutBox(
            id="product", type="component", x=150, y=150, w=200, h=200,
            label="phone",
        ),
        LayoutBox(
            id="cta", type="text", x=150, y=420, w=200, h=50,
            text="Buy Now",
            style=FlexNodeStyle(
                fontSize="medium", color="#FFFFFF",
                backgroundColor="#FF0000", borderRadius=8,
            ),
        ),
    ]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=500, canvas_h=500,
        bg_image_url="https://example.com/bg.jpg",
        component_images={"phone": "https://example.com/phone.png"},
    ))

    svg = result.svg
    # Gradient overlay
    assert "<linearGradient" in svg
    # Multi-layer shadow (headline has 2 shadows)
    assert svg.count("feDropShadow") >= 2
    # Component shadow
    assert "comp-shadow" in svg
    # Valid SVG
    assert svg.startswith("<svg")
    assert svg.endswith("</svg>")
    # All elements present
    assert "Big Sale" in svg
    assert "Buy Now" in svg
    assert "phone.png" in svg


def test_linear_fade_bottom():
    result = build_flex_svg(FlexSVGInput(
        boxes=[], canvas_w=1000, canvas_h=1000,
        bg_image_url="https://example.com/bg.jpg",
        background_effects=[
            {"type": "linear-fade", "from": "bottom", "color": "rgba(0,0,0,0.7)", "size": "40%"},
        ],
    ))
    assert "<linearGradient" in result.svg
    assert "bg-fade-0" in result.svg
    assert 'stop-opacity="0.7"' in result.svg


def test_linear_fade_right():
    result = build_flex_svg(FlexSVGInput(
        boxes=[], canvas_w=1000, canvas_h=1000,
        background_effects=[
            {"type": "linear-fade", "from": "right", "color": "rgba(0,0,0,0.5)", "size": "50%"},
        ],
    ))
    assert "<linearGradient" in result.svg
    assert 'x2="1"' in result.svg


def test_radial_fade_vignette():
    result = build_flex_svg(FlexSVGInput(
        boxes=[], canvas_w=1000, canvas_h=1000,
        background_effects=[
            {"type": "radial-fade", "center": "50% 40%", "radius": "70%", "color": "rgba(0,0,0,0.4)"},
        ],
    ))
    assert "<radialGradient" in result.svg
    assert "bg-radial-0" in result.svg
    assert 'cx="50%"' in result.svg
    assert 'cy="40%"' in result.svg


def test_multiple_background_effects():
    result = build_flex_svg(FlexSVGInput(
        boxes=[], canvas_w=1000, canvas_h=1000,
        background_effects=[
            {"type": "linear-fade", "from": "bottom", "color": "rgba(0,0,0,0.7)", "size": "40%"},
            {"type": "radial-fade", "center": "50% 50%", "radius": "60%", "color": "rgba(0,0,0,0.3)"},
        ],
    ))
    assert "bg-fade-0" in result.svg
    assert "bg-radial-1" in result.svg
    assert result.svg.count('<rect x="0" y="0"') >= 2
