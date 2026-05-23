// ============================================================
// RENDER SERVER — Luna Astrologica API
// Swiss Ephemeris (swisseph) — precisione professionale reale
// Node.js + Express
//
// IMPORTANTE: la libreria npm 'swisseph' usa API asincrona con callback
// Metodi: swe_calc_ut, swe_houses, swe_julday (tutti con prefisso swe_)
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
// swisseph usa callback: swe_calc_ut(jd, planet, flag, callback)
// Il callback riceve (result) dove result.longitude è la longitudine
app.post('/api/natal-chart', (req, res) => {
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

  const utHour = hour - tzOffset + (minute / 60);

  console.log('Natal chart request:', { year, month, day, utHour, lat, lng });

  // Calcolo Julian Day con swe_julday (sincrono)
  const jd = swisseph.swe_julday(year, month, day, utHour, swisseph.SE_GREG_CAL);
  console.log('Julian Day:', jd);

  const FLAG = swisseph.SEFLG_SPEED;
  const planets = [];
  let moonLon = null;

  // Funzione helper per calcolare un pianeta
  function calcPlanet(jd, planetId, key, callback) {
    swisseph.swe_calc_ut(jd, planetId, FLAG, (result) => {
      if (result.error) {
        console.error(`Error calculating ${key}:`, result.error);
        return callback(null);
      }
      console.log(`${key} longitude:`, result.longitude);
      if (key === 'moon') moonLon = result.longitude;
      callback({ key, lon: result.longitude });
    });
  }

  // Calcola tutti i pianeti in sequenza
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

  let completed = 0;
  function processNext(index) {
    if (index >= bodies.length) {
      // Tutti i pianeti calcolati, ora le case
      calcHouses();
      return;
    }
    const b = bodies[index];
    calcPlanet(jd, b.id, b.key, (result) => {
      if (result) planets.push(result);
      processNext(index + 1);
    });
  }

  function calcHouses() {
    // swe_houses(jd, lat, lng, hsys, callback)
    // Il callback riceve (result) con result.house array e result.ascendant, result.mc
    swisseph.swe_houses(jd, lat, lng, 'P', (houseResult) => {
      if (houseResult.error) {
        console.error('Houses error:', houseResult.error);
        return res.status(500).json({ error: 'Houses calculation failed: ' + houseResult.error });
      }

      console.log('Houses result:', houseResult);

      const asc = houseResult.ascendant;
      const mc = houseResult.mc;

      const response = {
        planets: planets.map(p => {
          const z = toZodiac(p.lon);
          return { key: p.key, sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol };
        }),
        moonSign: moonLon ? toZodiac(moonLon).name : null,
        ascendant: toZodiac(asc),
        mc: toZodiac(mc)
      };

      console.log('Chart response OK, planets:', planets.length);
      res.json(response);
    });
  }

  // Avvia il calcolo sequenziale
  processNext(0);
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', engine: 'swiss-ephemeris', precision: 'professional' });
});

// ===== SWISS EPHEMERIS TEST =====
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
          sun_latitude: result.latitude,
          ascendant: houseResult.ascendant,
          mc: houseResult.mc,
          swisseph_available: true
        });
      });
    });
  } catch (err) {
    console.error('Ephemeris test error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🌙 Luna Astrologica API running on port ${PORT}`);
});
