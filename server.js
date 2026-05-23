// ============================================================
// RENDER SERVER — Luna Astrologica API
// Swiss Ephemeris (swisseph npm) — precisione professionale reale
//
// STRUTTURA RISPOSTA swe_houses:
//   houseResult = {
//     house: [cusp1, cusp2, ..., cusp12],  // 12 case
//     ascendant: 175.78,                   // Ascendente
//     mc: 85.12,                           // MC
//     armc: 84.69,
//     vertex: 348.34,
//     equatorialAscendant: 174.21,
//     kochCoAscendant: 170.83,
//     munkaseyCoAscendant: 176.16,
//     munkaseyPolarAscendant: 350.83
//   }
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

// ===== GEOCODING =====
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

    res.json({ lat, lng: lon, display_name: place.display_name, timezone: `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`, tz_offset: tzOffset });
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== TEMA NATALE =====
app.post('/api/natal-chart', (req, res) => {
  const { birthDate, birthTime, lat, lng, timezone } = req.body;
  if (!birthDate || lat == null || lng == null) {
    return res.status(400).json({ error: 'Missing data' });
  }

  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour, minute] = (birthTime || '12:00').split(':').map(Number);

  let tzOffset = 0;
  if (timezone) {
    if (timezone === 'Europe/Rome' || timezone === 'Europe/Paris') tzOffset = 1;
    else if (timezone === 'Europe/London') tzOffset = 0;
    else if (timezone === 'America/New_York') tzOffset = -5;
    else tzOffset = Math.round(lng / 15);
  } else {
    tzOffset = Math.round(lng / 15);
  }

  const utHour = hour - tzOffset + (minute / 60);
  const jd = swisseph.swe_julday(year, month, day, utHour, swisseph.SE_GREG_CAL);

  console.log('Natal chart request:', { year, month, day, utHour, jd, lat, lng });

  const FLAG = swisseph.SEFLG_SPEED;
  const planets = [];
  let moonLon = null;

  function calcPlanet(jd, planetId, key, callback) {
    swisseph.swe_calc_ut(jd, planetId, FLAG, (result) => {
      if (result.error) {
        console.warn(`Error ${key}:`, result.error);
        return callback(null);
      }
      if (key === 'moon') moonLon = result.longitude;
      callback({ key, lon: result.longitude });
    });
  }

  const bodies = [
    { key: 'sun', id: swisseph.SE_SUN },
    { key: 'moon', id: swisseph.SE_MOON },
    { key: 'mercury', id: swisseph.SE_MERCURY },
    { key: 'venus', id: swisseph.SE_VENUS },
    { key: 'mars', id: swisseph.SE_MARS },
    { key: 'jupiter', id: swisseph.SE_JUPITER },
    { key: 'saturn', id: swisseph.SE_SATURN },
    { key: 'uranus', id: swisseph.SE_URANUS },
    { key: 'neptune', id: swisseph.SE_NEPTUNE },
    { key: 'pluto', id: swisseph.SE_PLUTO },
  ];

  let index = 0;
  function processNext() {
    if (index >= bodies.length) {
      calcHouses();
      return;
    }
    const b = bodies[index++];
    calcPlanet(jd, b.id, b.key, (result) => {
      if (result) planets.push(result);
      processNext();
    });
  }

  function calcHouses() {
    swisseph.swe_houses(jd, lat, lng, 'P', (houseResult) => {
      if (houseResult.error) {
        console.error('Houses error:', houseResult.error);
        return res.status(500).json({ error: 'Houses failed: ' + houseResult.error });
      }

      console.log('Houses result:', houseResult);

      // ✅ CORRETTO: usa .ascendant, .mc, .house[]
      const asc = houseResult.ascendant;
      const mc = houseResult.mc;

      const houses = [];
      for (let i = 0; i < 12; i++) {
        houses.push(toZodiac(houseResult.house[i]));
      }

      const response = {
        planets: planets.map(p => {
          const z = toZodiac(p.lon);
          return { key: p.key, sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol };
        }),
        moonSign: moonLon ? toZodiac(moonLon).name : null,
        ascendant: toZodiac(asc),
        mc: toZodiac(mc),
        houses: houses
      };

      console.log('Chart OK, planets:', planets.length, 'houses:', houses.length);
      res.json(response);
    });
  }

  processNext();
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', engine: 'swiss-ephemeris', precision: 'professional' });
});

// ===== TEST EPHEMERIS =====
app.get('/api/test-ephemeris', (req, res) => {
  try {
    const jd = swisseph.swe_julday(2000, 1, 1, 12, swisseph.SE_GREG_CAL);

    swisseph.swe_calc_ut(jd, swisseph.SE_SUN, swisseph.SEFLG_SPEED, (result) => {
      if (result.error) {
        return res.status(500).json({ error: 'Calc error: ' + result.error });
      }

      swisseph.swe_houses(jd, 45, 12, 'P', (houseResult) => {
        if (houseResult.error) {
          return res.status(500).json({ error: 'Houses error: ' + houseResult.error });
        }

        res.json({
          jd,
          sun_longitude: result.longitude,
          ascendant: houseResult.ascendant,
          mc: houseResult.mc,
          house1: houseResult.house[0],
          swisseph_available: true
        });
      });
    });
  } catch (err) {
    console.error('Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🌙 Luna Astrologica API running on port ${PORT}`);
});
