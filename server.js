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
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// ===== TRANSITI PLANETARI =====
app.post('/api/transits', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (pErr || !profile) return res.status(404).json({ error: 'Profilo non trovato' });

    // Calcola JD natale
    const [y, m, d] = profile.birth_date.split('-').map(Number);
    const [hh, mm] = profile.birth_time.split(':').map(Number);
    let tzOffset = 0;
    if (profile.birth_timezone === 'Europe/Rome') tzOffset = 2;
    else if (profile.birth_timezone.includes('GMT-1') || profile.birth_timezone.includes('CET')) tzOffset = 1;
    const utHour = hh - tzOffset + (mm / 60);
    const natalJD = swisseph.swe_julday(y, m, d, utHour, swisseph.SE_GREG_CAL);

    // Tema natale
    const natal = {};
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

    for (const b of bodies) {
      swisseph.swe_calc_ut(natalJD, b.id, swisseph.SEFLG_SPEED, (r) => {
        natal[b.key] = r.longitude;
      });
    }

    swisseph.swe_houses(natalJD, Number(profile.birth_latitude), Number(profile.birth_longitude), 'P', (h) => {
      natal.houses = h.house;
      natal.ascendant = h.ascendant;
      natal.mc = h.mc;
    });

    // Aspetti
    const ASPECTS = [
      { name: 'congiunzione', angle: 0, orb: 3 },
      { name: 'opposizione', angle: 180, orb: 3 },
      { name: 'quadrato', angle: 90, orb: 3 },
      { name: 'trigono', angle: 120, orb: 3 },
      { name: 'sestile', angle: 60, orb: 3 },
    ];

    function angleDiff(a, b) {
      let diff = Math.abs(a - b) % 360;
      return diff > 180 ? 360 - diff : diff;
    }

    function getHouse(deg, houses) {
      for (let i = 0; i < 12; i++) {
        let start = houses[i];
        let end = houses[(i + 1) % 12];
        let check = deg;
        if (start > end) { if (check < start) check += 360; end += 360; }
        else if (start > 270 && check < 90) check += 360;
        if (check >= start && check < end) return i + 1;
      }
      return 1;
    }

    // Calcola transiti 90 giorni
    const today = new Date();
    const events = [];
    const daily = [];

    for (let i = 0; i < 90; i++) {
      const cur = new Date(today);
      cur.setDate(today.getDate() + i);
      const jd = swisseph.swe_julday(cur.getFullYear(), cur.getMonth() + 1, cur.getDate(), 12, swisseph.SE_GREG_CAL);

      const trans = {};
      for (const b of bodies) {
        swisseph.swe_calc_ut(jd, b.id, swisseph.SEFLG_SPEED, (r) => {
          trans[b.key] = r.longitude;
        });
      }

      // Aspetti vs natali
      for (const [tName, tDeg] of Object.entries(trans)) {
        for (const [nName, nDeg] of Object.entries(natal)) {
          if (['houses', 'ascendant', 'mc'].includes(nName)) continue;
          for (const asp of ASPECTS) {
            const diff = angleDiff(tDeg, nDeg);
            if (Math.abs(diff - asp.angle) <= asp.orb) {
              const ed = cur.toISOString().split('T')[0];
              const nd = new Date(ed); nd.setDate(nd.getDate() - 3);
              events.push({
                user_id, event_date: ed,
                event_type: `${tName} ${asp.name} ${nName} (Natale)`,
                planet: tName, target: nName,
                orb: Number((Math.abs(diff - asp.angle)).toFixed(2)),
                notify_at: nd.toISOString().split('T')[0]
              });
            }
          }
        }
      }

      // Ingressi in case
      for (const [tName, tDeg] of Object.entries(trans)) {
        for (let h = 1; h <= 12; h++) {
          if (angleDiff(tDeg, natal.houses[h - 1]) < 1.0) {
            const ed = cur.toISOString().split('T')[0];
            const nd = new Date(ed); nd.setDate(nd.getDate() - 3);
            events.push({
              user_id, event_date: ed,
              event_type: `${tName} entra in Casa ${h}`,
              planet: tName, house: h,
              orb: Number(angleDiff(tDeg, natal.houses[h - 1]).toFixed(2)),
              notify_at: nd.toISOString().split('T')[0]
            });
          }
        }
      }

      // Cambi di segno
      if (i > 0) {
        const yest = new Date(cur); yest.setDate(yest.getDate() - 1);
        const jdY = swisseph.swe_julday(yest.getFullYear(), yest.getMonth() + 1, yest.getDate(), 12, swisseph.SE_GREG_CAL);
        for (const b of bodies) {
          swisseph.swe_calc_ut(jdY, b.id, swisseph.SEFLG_SPEED, (rY) => {
            const ySign = Math.floor(rY.longitude / 30);
            const tSign = Math.floor(trans[b.key] / 30);
            if (ySign !== tSign) {
              const ed = cur.toISOString().split('T')[0];
              const nd = new Date(ed); nd.setDate(nd.getDate() - 3);
              events.push({
                user_id, event_date: ed,
                event_type: `${b.key} entra in ${toZodiac(trans[b.key]).name}`,
                planet: b.key, orb: 0,
                notify_at: nd.toISOString().split('T')[0]
              });
            }
          });
        }
      }

      // Transiti di oggi
      if (i === 0) {
        for (const [name, deg] of Object.entries(trans)) {
          const aspects = [];
          for (const [nName, nDeg] of Object.entries(natal)) {
            if (['houses', 'ascendant', 'mc'].includes(nName)) continue;
            for (const asp of ASPECTS) {
              const diff = angleDiff(deg, nDeg);
              if (Math.abs(diff - asp.angle) <= asp.orb) {
                aspects.push({ natalPlanet: nName, aspect: asp.name, orb: Number((Math.abs(diff - asp.angle)).toFixed(2)) });
              }
            }
          }
          daily.push({
            planet: name, degree: Math.round(deg * 100) / 100,
            sign: toZodiac(deg).name, house: getHouse(deg, natal.houses),
            aspectsToNatal: aspects
          });
        }
      }
    }

    // Salva eventi
    if (events.length > 0) {
      const seen = new Set();
      const unique = [];
      for (const e of events) {
        const k = `${e.user_id}|${e.event_date}|${e.event_type}`;
        if (!seen.has(k)) { seen.add(k); unique.push(e); }
      }
      await supabase.from('upcoming_events').upsert(unique, { onConflict: 'user_id,event_date,event_type' });
    }

    res.json({
      date: today.toISOString().split('T')[0],
      natal: {
        ascendant: Math.round(natal.ascendant * 100) / 100,
        ascendantSign: toZodiac(natal.ascendant).name,
        mc: Math.round(natal.mc * 100) / 100,
        mcSign: toZodiac(natal.mc).name,
      },
      transitsToday: daily,
      eventsFound: events.length,
      message: 'Transiti calcolati e salvati'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET di test per verificare che l'endpoint è vivo
app.get('/api/transits', (req, res) => {
  res.json({ status: 'Transits API attivo', use: 'POST /api/transits con body { user_id }' });
});
app.listen(PORT, () => {
  console.log(`🌙 Luna Astrologica API running on port ${PORT}`);
});
