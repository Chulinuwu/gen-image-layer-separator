from app.utils.safe_zones import compute_safe_zones, assign_text_to_zones, BBox, TextSuggestion


def test_no_obstacles_returns_full_canvas():
    zones = compute_safe_zones([])
    assert len(zones) == 1
    assert zones[0].area == 1000 * 1000


def test_center_obstacle_creates_multiple_zones():
    obs = [BBox(top=400, left=400, width=200, height=200)]
    zones = compute_safe_zones(obs)
    assert len(zones) >= 2
    for z in zones:
        assert z.width >= 150
        assert z.height >= 50


def test_small_zones_filtered_out():
    obs = [BBox(top=0, left=0, width=950, height=950)]
    zones = compute_safe_zones(obs)
    for z in zones:
        assert z.width >= 150
        assert z.height >= 50


def test_zones_sorted_by_area_descending():
    obs = [BBox(top=300, left=300, width=200, height=200)]
    zones = compute_safe_zones(obs)
    for i in range(len(zones) - 1):
        assert zones[i].area >= zones[i + 1].area


def test_zone_labels_are_valid():
    obs = [BBox(top=400, left=400, width=200, height=200)]
    zones = compute_safe_zones(obs)
    valid_parts = {"top", "center", "bottom", "left", "right"}
    for z in zones:
        parts = z.label.split("-")
        for p in parts:
            assert p in valid_parts
