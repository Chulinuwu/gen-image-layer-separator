import pytest
from app.utils.flex_layout import compute_flex_layout, FlexNode


def test_single_leaf():
    root = FlexNode(id="root", type="text", text="hello")
    boxes = compute_flex_layout(root, 1080, 1080)
    assert len(boxes) == 1
    assert boxes[0].id == "root"
    assert boxes[0].x == 0
    assert boxes[0].y == 0
    assert boxes[0].w == 1080
    assert boxes[0].h == 1080


def test_row_with_two_children():
    root = FlexNode(
        id="root",
        direction="row",
        children=[
            FlexNode(id="left", type="text", text="L", width="50%"),
            FlexNode(id="right", type="text", text="R", width="50%"),
        ],
    )
    boxes = compute_flex_layout(root, 1000, 500)
    assert len(boxes) == 2
    left = next(b for b in boxes if b.id == "left")
    right = next(b for b in boxes if b.id == "right")
    gap = 8  # default gap
    avail = 1000 - gap
    assert left.w == pytest.approx(avail * 0.5, abs=1)
    assert right.w == pytest.approx(avail * 0.5, abs=1)
    assert right.x > left.x


def test_column_with_padding():
    root = FlexNode(
        id="root",
        direction="column",
        padding=20,
        children=[
            FlexNode(id="top", type="text", text="T", height="60%"),
            FlexNode(id="bot", type="component", label="img", height="40%"),
        ],
    )
    boxes = compute_flex_layout(root, 500, 1000)
    assert len(boxes) == 2
    top = next(b for b in boxes if b.id == "top")
    assert top.x == 20  # padding
    assert top.y == 20


def test_unsized_children_share_remaining():
    root = FlexNode(
        id="root",
        direction="row",
        gap=0,
        children=[
            FlexNode(id="a", type="text", text="A", width="50%"),
            FlexNode(id="b", type="text", text="B"),
            FlexNode(id="c", type="text", text="C"),
        ],
    )
    boxes = compute_flex_layout(root, 1000, 100)
    a = next(b for b in boxes if b.id == "a")
    b = next(b for b in boxes if b.id == "b")
    c = next(b for b in boxes if b.id == "c")
    assert a.w == pytest.approx(500, abs=1)
    assert b.w == pytest.approx(250, abs=1)
    assert c.w == pytest.approx(250, abs=1)


def test_nested_layout():
    root = FlexNode(
        id="root",
        direction="column",
        gap=0,
        padding=0,
        children=[
            FlexNode(id="header", type="text", text="Header", height="20%"),
            FlexNode(
                id="body",
                direction="row",
                gap=0,
                height="80%",
                children=[
                    FlexNode(id="sidebar", type="component", label="side", width="30%"),
                    FlexNode(id="content", type="text", text="Main", width="70%"),
                ],
            ),
        ],
    )
    boxes = compute_flex_layout(root, 1000, 1000)
    assert len(boxes) == 3
    header = next(b for b in boxes if b.id == "header")
    sidebar = next(b for b in boxes if b.id == "sidebar")
    content = next(b for b in boxes if b.id == "content")
    assert header.h == pytest.approx(200, abs=1)
    assert sidebar.h == pytest.approx(800, abs=1)
    assert content.w == pytest.approx(700, abs=1)


def test_margin_shifts_position():
    root = {
        "id": "root", "direction": "column", "padding": 0, "gap": 0,
        "children": [
            {"id": "a", "type": "text", "text": "A", "height": "50%",
             "style": {"fontSize": "large", "margin": 10}},
            {"id": "b", "type": "text", "text": "B", "height": "50%"},
        ],
    }
    boxes = compute_flex_layout(root, 400, 200)
    a = next(b for b in boxes if b.id == "a")
    b = next(b for b in boxes if b.id == "b")
    assert a.x == 10
    assert a.y == 10
    assert a.w == 380  # 400 - 10*2
    assert a.h == 80   # 100 - 10*2


from app.prompts.flex_layout import build_flex_thought_prompt


def test_flex_thought_includes_style_spec_when_provided():
    spec_md = "## A. Visual Mood\n\nluxury serious editorial.\n\n## C. Typography Personality\n\ntight tracking display serif."
    p = build_flex_thought_prompt(
        target_text="Headline",
        components_list="",
        canvas_size={"w": 1000, "h": 1000},
        style_spec_md=spec_md,
    )
    assert "luxury" in p
    assert "Typography Personality" in p
    assert "match" in p.lower() or "adhere" in p.lower()


def test_flex_thought_works_without_style_spec():
    p = build_flex_thought_prompt(
        target_text="Headline",
        components_list="",
        canvas_size={"w": 1000, "h": 1000},
        style_spec_md=None,
    )
    assert "Headline" in p


def test_flex_tree_prompt_includes_zone_map_enforcement_when_spec_present():
    from app.prompts.flex_layout import build_flex_tree_prompt
    spec_md = "## 5. Layout Principles\n\nTop 0-25%: headline band. 25-70%: hero zone."
    p = build_flex_tree_prompt(
        target_text="Head",
        components_list="",
        footer_section="",
        canvas_size={"w": 1000, "h": 1000},
        layout_thought="test thought",
        style_spec_md=spec_md,
    )
    assert "ZONE MAP ENFORCEMENT" in p
    assert "HARD CONSTRAINT" in p
    assert "headline band" in p or "hero zone" in p


def test_flex_tree_prompt_includes_component_emission_rules_when_spec_present():
    from app.prompts.flex_layout import build_flex_tree_prompt
    spec_md = "## 4. Components\nFrosted glassmorphic card for product details. Pill CTA centered."
    p = build_flex_tree_prompt(
        target_text="Head",
        components_list="",
        footer_section="",
        canvas_size={"w": 1000, "h": 1000},
        layout_thought="",
        style_spec_md=spec_md,
    )
    assert "COMPONENT PATTERN EMISSION" in p
    assert "Frosted glassmorphic card" in p
    assert "Pill CTA" in p
    assert "rgba(255, 255, 255, 0.10)" in p
    assert "borderRadius 9999" in p


def test_flex_tree_prompt_skips_new_sections_when_no_spec():
    from app.prompts.flex_layout import build_flex_tree_prompt
    p = build_flex_tree_prompt(
        target_text="Head",
        components_list="",
        footer_section="",
        canvas_size={"w": 1000, "h": 1000},
        layout_thought="",
        style_spec_md=None,
    )
    assert "ZONE MAP ENFORCEMENT" not in p
    assert "COMPONENT PATTERN EMISSION" not in p
