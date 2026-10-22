// Tomorrow's weather for a few cities (Open-Meteo, free, no key) for Mark Twine's forecast. Real numbers, code only.
import { fetchJson, soft } from "./util.mjs";

const WMO = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle", 61: "rain", 63: "rain", 65: "heavy rain", 71: "snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "violent showers", 95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms" };

export async function gatherWeather(cities, notes) {
  const out = [];
  for (const c of cities) {
    const w = await soft(`weather ${c.city}`, async () => {
      const j = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&temperature_unit=fahrenheit&timezone=auto&forecast_days=2`);
      const i = 1; // tomorrow (the paper's day)
      return { city: c.city, highF: j.daily.temperature_2m_max[i], lowF: j.daily.temperature_2m_min[i], sky: WMO[j.daily.weathercode[i]] ?? "weather", rainPct: j.daily.precipitation_probability_max?.[i] ?? null };
    }, null, notes);
    if (w) out.push(w);
  }
  return out;
}

export const mockWeather = (cities) => cities.map((c, i) => ({ city: c.city, highF: 61 + i * 3, lowF: 48 + i, sky: ["partly cloudy", "rain", "clear", "fog"][i % 4], rainPct: [20, 80, 0, 10][i % 4], mock: true }));
