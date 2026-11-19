import { readFile } from "node:fs/promises";
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";

export async function mapAssets() {
  const topology = JSON.parse(await readFile(new URL(import.meta.resolve("world-atlas/countries-110m.json")), "utf8"));
  const countries = topology.objects.countries;
  const projection = geoEquirectangular().scale(960 / (2 * Math.PI)).translate([480, 240]);
  const path = geoPath(projection).digits(1);
  const land = path(feature(topology, countries));
  const borders = path(mesh(topology, countries, (a, b) => a !== b));
  // Transparent ocean and translucent land so the map reads on light and dark backgrounds;
  // the page supplies the ocean colour.
  const map = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 480"><path d="${land}" fill="#8a919b" fill-opacity=".26"/><path d="${borders}" fill="none" stroke="#8a919b" stroke-opacity=".5" stroke-width=".55"/></svg>`;

  const source = JSON.parse(await readFile(new URL(import.meta.resolve("city-timezones/data/cityMap.json")), "utf8"));
  const cities = new Map();
  for (const { city, province, country, lat, lng } of source) {
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
      throw new Error(`Invalid coordinates for ${city}`);
    }
    const label = [...new Set([city, province, country].filter(Boolean))].join(", ");
    cities.set(label, [label, Number(lat.toFixed(4)), Number(lng.toFixed(4))]);
  }
  const india = JSON.parse(await readFile(new URL("./data/india-places.json", import.meta.url), "utf8"));
  for (const [label, lat, lng, aliases] of india) {
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
      throw new Error(`Invalid coordinates for ${label}`);
    }
    const pin = cities.get(label) ?? [label, lat, lng];
    cities.set(label, [...pin.slice(0, 3), aliases]);
  }
  return {
    "/world-map.svg": { type: "image/svg+xml", body: map },
    "/map-cities.json": { type: "application/json", body: JSON.stringify([...cities.values()].sort(([a], [b]) => a.localeCompare(b))) },
  };
}
