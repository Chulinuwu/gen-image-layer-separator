import { computeSafeZones, BBox, SafeZone } from "./safeZones";

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
