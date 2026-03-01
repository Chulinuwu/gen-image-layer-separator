import { computeSafeZones, BBox, SafeZone, assignTextToZones, TextSuggestion } from "./safeZones";

describe("computeSafeZones", () => {
  it("returns full canvas when no obstacles", () => {
    const zones = computeSafeZones([]);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ top: 0, left: 0, width: 1000, height: 1000 });
  });

  it("splits canvas around a centered obstacle", () => {
    const obstacle: BBox = { top: 400, left: 300, width: 400, height: 400 };
    const zones = computeSafeZones([obstacle]);
    // All zones should have no overlap with the padded obstacle
    for (const zone of zones) {
      const zRight = zone.left + zone.width;
      const zBottom = zone.top + zone.height;
      const noOverlap =
        zRight <= obstacle.left ||
        zone.left >= obstacle.left + obstacle.width ||
        zBottom <= obstacle.top ||
        zone.top >= obstacle.top + obstacle.height;
      expect(noOverlap).toBe(true);
    }
  });

  it("filters out zones too small for text (width < 150 AND height < 50)", () => {
    const obstacle: BBox = { top: 0, left: 50, width: 900, height: 1000 };
    const zones = computeSafeZones([obstacle]);
    for (const zone of zones) {
      expect(zone.width >= 150 || zone.height >= 50).toBe(true);
    }
  });

  it("returns zones sorted by area descending", () => {
    const obstacle: BBox = { top: 200, left: 600, width: 300, height: 600 };
    const zones = computeSafeZones([obstacle]);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i - 1].area).toBeGreaterThanOrEqual(zones[i].area);
    }
  });

  it("handles multiple obstacles without overlapping any", () => {
    const obstacles: BBox[] = [
      { top: 100, left: 400, width: 200, height: 500 },
      { top: 700, left: 0, width: 1000, height: 200 },
    ];
    const zones = computeSafeZones(obstacles);
    for (const zone of zones) {
      for (const obs of obstacles) {
        const zRight = zone.left + zone.width;
        const zBottom = zone.top + zone.height;
        const noOverlap =
          zRight <= obs.left ||
          zone.left >= obs.left + obs.width ||
          zBottom <= obs.top ||
          zone.top >= obs.top + obs.height;
        expect(noOverlap).toBe(true);
      }
    }
  });
});

describe("assignTextToZones", () => {
  const zones: SafeZone[] = [
    { top: 50, left: 50, width: 300, height: 800, area: 240000, label: "top-left" },
    { top: 50, left: 700, width: 250, height: 400, area: 100000, label: "top-right" },
    { top: 700, left: 400, width: 500, height: 250, area: 125000, label: "bottom-center" },
  ];

  it("places text within its preferred zone boundaries", () => {
    const suggestions: TextSuggestion[] = [
      { part: "HEADLINE", preferred_zone: "top-left", style: { font_size_normalized: 80 } },
    ];
    const result = assignTextToZones(suggestions, zones);
    const pos = result[0].position;
    expect(pos.left).toBeGreaterThanOrEqual(zones[0].left);
    expect(pos.top).toBeGreaterThanOrEqual(zones[0].top);
    expect(pos.left + pos.width).toBeLessThanOrEqual(zones[0].left + zones[0].width);
  });

  it("falls back to largest zone when preferred zone not found", () => {
    const suggestions: TextSuggestion[] = [
      { part: "BODY", preferred_zone: "nonexistent-zone", style: { font_size_normalized: 40 } },
    ];
    const result = assignTextToZones(suggestions, zones);
    // Should use a real zone (not undefined)
    expect(result[0].position).toBeDefined();
    expect(result[0].position.left).toBeGreaterThanOrEqual(0);
  });

  it("stacks multiple elements in same zone without overlap", () => {
    const suggestions: TextSuggestion[] = [
      { part: "BIG HEADLINE TEXT HERE", preferred_zone: "top-left", style: { font_size_normalized: 80 } },
      { part: "subtitle text", preferred_zone: "top-left", style: { font_size_normalized: 30 } },
    ];
    const result = assignTextToZones(suggestions, zones);
    const first = result[0].position;
    const second = result[1].position;
    // Second element should start below the first
    expect(second.top).toBeGreaterThan(first.top);
  });

  it("returns original suggestions when no zones provided", () => {
    const suggestions: TextSuggestion[] = [
      { part: "TEXT", style: { font_size_normalized: 40 } },
    ];
    const result = assignTextToZones(suggestions, []);
    expect(result).toHaveLength(1);
    expect(result[0].part).toBe("TEXT");
  });
});
