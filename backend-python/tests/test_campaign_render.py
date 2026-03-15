from app.utils.svg_builder import build_flex_svg, FlexSVGInput, FlexSVGResult
from app.utils.flex_layout import LayoutBox, FlexNodeStyle


def test_build_flex_svg_accepts_dataclass_not_kwargs():
    boxes = [LayoutBox(id="t1", type="text", x=10, y=10, w=400, h=100,
                       text="Test", style=FlexNodeStyle(fontSize="medium", color="#FFF"))]
    result = build_flex_svg(FlexSVGInput(
        boxes=boxes, canvas_w=1000, canvas_h=1777,
    ))
    assert isinstance(result, FlexSVGResult)
    assert isinstance(result.svg, str)
    assert "<svg" in result.svg
    assert "Test" in result.svg


def test_flex_svg_result_is_dataclass_not_dict():
    boxes = [LayoutBox(id="t1", type="text", x=0, y=0, w=100, h=50,
                       text="Hi", style=FlexNodeStyle(fontSize="small", color="#000"))]
    result = build_flex_svg(FlexSVGInput(boxes=boxes, canvas_w=500, canvas_h=500))
    assert hasattr(result, "svg")
    assert hasattr(result, "boxes")
    try:
        _ = result["svg"]
        assert False, "FlexSVGResult should not support dict access"
    except TypeError:
        pass
