// ============================================================
// RENDER SERVER — Luna Astrologica API
// Swiss Ephemeris (swisseph) — precisione professionale reale
// Node.js + Express
// ============================================================

const express = require('express');
const swisseph = require('swisseph');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const ZODIAC = [
  {name:'Ariete',symbol:'♈'},{name:'Toro',symbol:'♉'},{name:'Gemelli',symbol:'♊'},
  {name:'Cancro',symbol:'♋'},{name:'Leone',symbol:'♌'},{name:'Vergine',symbol:'♍'},
  {name:'Bilancia',symbol:'♎'},{name:'Scorpione',symbol:'♏'},{name:'Sagittario',symbol:'♐'},
  {name:'Capricorno',symbol:'♑'},{name:'Acquario',symbol:'♒'},{name:'Pesci',symbol:'♓'}
];

function toZodiac(deg) {
  const d = ((deg % 360) + 360) % 360;
  const idx = Math.floor(d / 30) % 12;
  return { ...ZODIAC[idx], degree: Math.floor(d % 30), minutes: Math.floor(((d % 30) % 1) * 60) };
}

function julianDay(y, m, d, h, min) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + h / 24 + min / 1440;
}

// ===== GEOCODING (usa Nominatim) =====
app.get('/api/geocode', async (req, res) => {
  try {
    const city = req.query.city;
    const country = req.query.country;
    if (!city) return res.status(400).json({ error: 'Missing city' });

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city + ',' + (country || ''))}&limit=1`;
    const response = await fetch(url, { headers: { 'User-Agent': 'LunaAstrologica/1.0' } });
    const data = await response.json();

    if (!data || !data.length) return res.status(404).json({ error: 'City not found' });

    const place = data[0];
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    const tzOffset = Math.round(lon / 15);

    res.json({
      lat, lng: lon,
      display_name: place.display_name,
      timezone: tzOffset >= 0 ? `Etc/GMT-${tzOffset}` : `Etc/GMT+${Math.abs(tzOffset)}`,
      tz_offset: tzOffset
    });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== TEMA NATALE CON SWISS EPHEMERIS =====
app.post('/api/natal-chart', (req, res) => {
  try {
    const { birthDate, birthTime, lat, lng, timezone } = req.body;
    if (!birthDate || lat == null || lng == null) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const [year, month, day] = birthDate.split('-').map(Number);
    const [hour, minute] = (birthTime || '12:00').split(':').map(Number);

    // Timezone offset
    let tzOffset = 0;
    if (timezone) {
      if (timezone === 'Europe/Rome' || timezone === 'Europe/Paris') tzOffset = 1;
      else if (timezone === 'Europe/London') tzOffset = 0;
      else if (timezone === 'America/New_York') tzOffset = -5;
      else tzOffset = Math.round(lng / 15);
    } else {
      tzOffset = Math.round(lng / 15);
    }

    const utHour = hour - tzOffset;
    const jd = julianDay(year, month, day, utHour, minute);

    console.log('Natal chart request:', { year, month, day, utHour, minute, jd, lat, lng });

    // Calcolo posizioni con Swiss Ephemeris
    // Flag 0 = eclittiche (longitudine zodiacale), NON equatoriali
    const FLAG_ECLIPTIC = 0;
    const planets = [];

    // SOLE
    const sun = swisseph.calc_ut(jd, swisseph.SE_SUN, FLAG_ECLIPTIC);
    if (sun.error) throw new Error('Sun calc error: ' + sun.error);
    const sunLon = sun.longitude;
    planets.push({ key: 'sun', lon: sunLon });

    // LUNA
    const moon = swisseph.calc_ut(jd, swisseph.SE_MOON, FLAG_ECLIPTIC);
    if (moon.error) throw new Error('Moon calc error: ' + moon.error);
    const moonLon = moon.longitude;
    planets.push({ key: 'moon', lon: moonLon });

    // PIANETI
    const bodies = [
      { key: 'mercury', id: swisseph.SE_MERCURY },
      { key: 'venus', id: swisseph.SE_VENUS },
      { key: 'mars', id: swisseph.SE_MARS },
      { key: 'jupiter', id: swisseph.SE_JUPITER },
      { key: 'saturn', id: swisseph.SE_SATURN },
      { key: 'uranus', id: swisseph.SE_URANUS },
      { key: 'neptune', id: swisseph.SE_NEPTUNE },
      { key: 'pluto', id: swisseph.SE_PLUTO },
    ];

    for (const p of bodies) {
      const pos = swisseph.calc_ut(jd, p.id, FLAG_ECLIPTIC);
      if (pos.error) {
        console.warn('Planet calc error:', p.key, pos.error);
        continue;
      }
      planets.push({ key: p.key, lon: pos.longitude });
    }

    // Ascendente e MC (case Placidus)
    // swisseph.houses() restituisce un array, NON un oggetto
    const houses = swisseph.houses(jd, lat, lng, 'P'); // 'P' = Placidus
    const asc = houses[0];   // ascendant
    const mc = houses[1];    // MC (Medium Coeli)

    console.log('Houses calculated:', { asc, mc });

    const response = {
      planets: planets.map(p => {
        const z = toZodiac(p.lon);
        return { key: p.key, sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol };
      }),
      moonSign: toZodiac(moonLon).name,
      ascendant: toZodiac(asc),
      mc: toZodiac(mc)
    };

    console.log('Chart response OK');
    res.json(response);

  } catch (err) {
    console.error('Natal chart error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', engine: 'swiss-ephemeris', precision: 'professional' });
});

// ===== SWISS EPHEMERIS TEST =====
app.get('/api/test-ephemeris', (req, res) => {
  try {
    const jd = swisseph.julday(2000, 1, 1, 12, 1);
    const sun = swisseph.calc_ut(jd, swisseph.SE_SUN, 0);
    const houses = swisseph.houses(jd, 45, 12, 'P');
    res.json({
      jd,
      sun_longitude: sun.longitude,
      sun_latitude: sun.latitude,
      ascendant: houses[0],
      mc: houses[1],
      swisseph_version: swisseph.version || 'unknown'
    });
  } catch (err) {
    console.error('Ephemeris test error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.listen(PORT, () => {
  console.log(`🌙 Luna Astrologica API running on port ${PORT}`);
});
