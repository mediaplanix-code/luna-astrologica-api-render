// ============================================================
// RENDER SERVER -- Luna Astrologica API
// Swiss Ephemeris (swisseph npm) -- precisione professionale reale
// VERSIONE DEFENSIVA: gestisce tutti i casi limite senza crashare
// ============================================================

const express = require('express');
const swisseph = require('swisseph');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Configurazione Supabase con gestione errori
let supabase = null;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('Supabase client initialized');
} catch (e) {
  console.error('Supabase init failed:', e.message);
}

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

function calcSeverity(planet, targetPlanet, orb, aspectType) {
  const SLOW_PLANETS = ['saturn', 'uranus', 'neptune', 'pluto'];
  const MEDIUM_PLANETS = ['jupiter', 'mars'];
  const isSlow = SLOW_PLANETS.includes(planet);
  const isMedium = MEDIUM_PLANETS.includes(planet);
  const isTargetSlow = targetPlanet && SLOW_PLANETS.includes(targetPlanet);
  const STRONG_ASPECTS = ['congiunzione', 'quadrato', 'opposizione'];
  const isStrongAspect = STRONG_ASPECTS.includes(aspectType);

  if (isSlow && orb <= 1.0 && isStrongAspect) return 'high';
  if (isSlow && orb <= 2.0) return 'high';
  if (isMedium && orb <= 1.0 && isStrongAspect) return 'high';
  if (isTargetSlow && orb <= 1.0) return 'high';
  if (isSlow && orb <= 3.0) return 'medium';
  if (isMedium && orb <= 2.0) return 'medium';
  if (orb <= 1.0) return 'medium';
  return 'low';
}

function calcPlanetSync(jd, planetId) {
  try {
    const result = swisseph.swe_calc_ut(jd, planetId, swisseph.SEFLG_SPEED);
    if (result.error) {
      console.warn('Calc error:', result.error);
      return null;
    }
    return result.longitude;
  } catch (e) {
    console.warn('Planet calc exception:', e.message);
    return null;
  }
}

function calcHousesSync(jd, lat, lng) {
  try {
    const result = swisseph.swe_houses(jd, lat, lng, 'P');
    if (result.error) {
      console.error('Houses error:', result.error);
      return null;
    }
    return result;
  } catch (e) {
    console.error('Houses calc exception:', e.message);
    return null;
  }
}

async function safeFetchJson(url, options = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`HTTP ${response.status} from ${url}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn(`Non-JSON response from ${url}: ${contentType}`);
      return null;
    }
    return await response.json();
  } catch (err) {
    console.warn(`Fetch error for ${url}:`, err.message);
    return null;
  }
}

// ===== GEOCODING =====
app.get('/api/geocode', async (req, res) => {
  try {
    const city = req.query.city;
    const country = req.query.country;
    if (!city) return res.status(400).json({ error: 'Missing city' });

    const query = encodeURIComponent(city + ',' + (country || ''));
    let lat = null;
    let lon = null;
    let display_name = null;
    let source = null;

    const nominatimData = await safeFetchJson(
      `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`,
      { headers: { 'User-Agent': 'LunaAstrologica/1.0' } }
    );
    if (nominatimData && nominatimData.length > 0) {
      lat = parseFloat(nominatimData[0].lat);
      lon = parseFloat(nominatimData[0].lon);
      display_name = nominatimData[0].display_name;
      source = 'nominatim';
    }

    if (lat === null) {
      const openMeteoData = await safeFetchJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=it&format=json`
      );
      if (openMeteoData && openMeteoData.results && openMeteoData.results.length > 0) {
        lat = openMeteoData.results[0].latitude;
        lon = openMeteoData.results[0].longitude;
        display_name = `${openMeteoData.results[0].name}, ${openMeteoData.results[0].country || country || ''}`;
        source = 'open-meteo';
      }
    }

    if (lat === null || lon === null) {
      return res.status(404).json({ error: 'City not found', city, country });
    }

    const tzOffset = Math.round(lon / 15);
    const timezone = `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`;

    res.json({ lat, lng: lon, display_name: display_name || `${city}, ${country || ''}`, timezone, tz_offset: tzOffset, source });
  } catch (err) {
    console.error('Geocode fatal error:', err);
    res.status(500).json({ error: err.message || 'Internal geocoding error' });
  }
});

// ===== TEMA NATALE =====
app.post('/api/natal-chart', async (req, res) => {
  try {
    const { birthDate, birthTime, lat, lng, timezone, user_id } = req.body;
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

    const planets = [];
    let moonLon = null;

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
      const lon = calcPlanetSync(jd, b.id);
      if (lon !== null) {
        if (b.key === 'moon') moonLon = lon;
        planets.push({ key: b.key, lon });
      }
    }

    const houseResult = calcHousesSync(jd, lat, lng);
    if (!houseResult) {
      return res.status(500).json({ error: 'Houses calculation failed' });
    }

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

    // SALVA in natal_charts (upsert) -- con gestione errori
    if (user_id && supabase) {
      try {
        const { error: upsertErr } = await supabase
          .from('natal_charts')
          .upsert({
            user_id: user_id,
            planets: response.planets,
            houses: response.houses,
            aspects: [],
            points: {
              ascendant: response.ascendant,
              mc: response.mc,
              moon_sign: response.moonSign
            },
            house_system: 'Placidus',
            zodiac_type: 'Tropic',
            calculation_engine: 'swisseph',
            is_verified: true,
            calculated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (upsertErr) {
          console.error('Errore salvataggio natal_charts:', upsertErr.message);
        }
      } catch (dbErr) {
        console.error('DB error natal_charts:', dbErr.message);
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Natal chart error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', engine: 'swiss-ephemeris', precision: 'professional' });
});

// ===== TEST EPHEMERIS =====
app.get('/api/test-ephemeris', (req, res) => {
  try {
    const jd = swisseph.swe_julday(2000, 1, 1, 12, swisseph.SE_GREG_CAL);
    const sunResult = swisseph.swe_calc_ut(jd, swisseph.SE_SUN, swisseph.SEFLG_SPEED);
    if (sunResult.error) {
      return res.status(500).json({ error: 'Calc error: ' + sunResult.error });
    }
    const houseResult = swisseph.swe_houses(jd, 45, 12, 'P');
    if (houseResult.error) {
      return res.status(500).json({ error: 'Houses error: ' + houseResult.error });
    }
    res.json({ jd, sun_longitude: sunResult.longitude, ascendant: houseResult.ascendant, mc: houseResult.mc, house1: houseResult.house[0], swisseph_available: true });
  } catch (err) {
    console.error('Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== TRANSITI PLANETARI -- VERSIONE DEFENSIVA =====
app.post('/api/transits', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // 1. Leggi profilo
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (pErr || !profile) {
      console.error('Profile fetch error:', pErr?.message || 'not found');
      return res.status(404).json({ error: 'Profilo non trovato' });
    }

    console.log('Transits profile:', {
      id: profile.id,
      birth_date: profile.birth_date,
      birth_time: profile.birth_time,
      birth_latitude: profile.birth_latitude,
      birth_longitude: profile.birth_longitude,
      birth_timezone: profile.birth_timezone
    });

    // 2. Validazione dati
    if (!profile.birth_date) {
      return res.status(400).json({ error: 'Data di nascita mancante' });
    }

    const lat = Number(profile.birth_latitude);
    const lng = Number(profile.birth_longitude);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Coordinate mancanti. Completa prima il geocoding.' });
    }

    // 3. Parsing data e ora
    const [y, m, d] = profile.birth_date.split('-').map(Number);
    const birthTime = profile.birth_time || '12:00';
    const [hh, mm] = birthTime.split(':').map(Number);

    // 4. Timezone
    let tzOffset = 0;
    if (profile.birth_timezone) {
      if (profile.birth_timezone === 'Europe/Rome') tzOffset = 2;
      else if (profile.birth_timezone.includes('GMT-1') || profile.birth_timezone.includes('CET')) tzOffset = 1;
      else if (profile.birth_timezone.includes('GMT')) {
        const match = profile.birth_timezone.match(/GMT([+-]?\d+)/);
        if (match) tzOffset = parseInt(match[1]);
      }
    }

    const utHour = hh - tzOffset + (mm / 60);
    const natalJD = swisseph.swe_julday(y, m, d, utHour, swisseph.SE_GREG_CAL);

    // 5. Calcolo tema natale
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
      const lon = calcPlanetSync(natalJD, b.id);
      if (lon !== null) natal[b.key] = lon;
    }

    const houseResult = calcHousesSync(natalJD, lat, lng);
    if (houseResult) {
      natal.houses = houseResult.house;
      natal.ascendant = houseResult.ascendant;
      natal.mc = houseResult.mc;
    } else {
      return res.status(500).json({ error: 'Calcolo case fallito' });
    }

    console.log('Natal calcolato, pianeti:', Object.keys(natal).filter(k => !['houses','ascendant','mc'].includes(k)));

    // 6. Aspetti e transiti
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

    // 7. Calcola transiti 90 giorni
    const today = new Date();
    const allEvents = [];
    const daily = [];

    for (let i = 0; i < 90; i++) {
      const cur = new Date(today);
      cur.setDate(today.getDate() + i);
      const jd = swisseph.swe_julday(cur.getFullYear(), cur.getMonth() + 1, cur.getDate(), 12, swisseph.SE_GREG_CAL);

      const trans = {};
      for (const b of bodies) {
        const lon = calcPlanetSync(jd, b.id);
        if (lon !== null) trans[b.key] = lon;
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
              const orbVal = Number((Math.abs(diff - asp.angle)).toFixed(2));
              const severity = calcSeverity(tName, nName, orbVal, asp.name);

              allEvents.push({
                event_date: ed,
                event_type: 'major_aspect',
                planet: tName,
                target_planet: nName,
                aspect_type: asp.name,
                orb_degrees: orbVal,
                title: `${tName} ${asp.name} ${nName} (Natale)`,
                description: `Il transito di ${tName} forma un ${asp.name} con ${nName} del tema natale. Orb: ${orbVal}°`,
                severity: severity,
                exact_timestamp: nd.toISOString()
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
            const orbVal = Number(angleDiff(tDeg, natal.houses[h - 1]).toFixed(2));
            const severity = calcSeverity(tName, null, orbVal, 'ingresso');

            allEvents.push({
              event_date: ed,
              event_type: 'planet_enters_house',
              planet: tName,
              house: h,
              orb_degrees: orbVal,
              title: `${tName} entra in Casa ${h}`,
              description: `Il pianeta ${tName} entra nella Casa ${h} del tema natale.`,
              severity: severity,
              exact_timestamp: nd.toISOString()
            });
          }
        }
      }

      // Cambi di segno
      if (i > 0) {
        const yest = new Date(cur); yest.setDate(yest.getDate() - 1);
        const jdY = swisseph.swe_julday(yest.getFullYear(), yest.getMonth() + 1, yest.getDate(), 12, swisseph.SE_GREG_CAL);
        for (const b of bodies) {
          const lonY = calcPlanetSync(jdY, b.id);
          const lonT = trans[b.key];
          if (lonY !== null && lonT !== undefined) {
            const ySign = Math.floor(lonY / 30);
            const tSign = Math.floor(lonT / 30);
            if (ySign !== tSign) {
              const ed = cur.toISOString().split('T')[0];
              const nd = new Date(ed); nd.setDate(nd.getDate() - 3);
              const newSign = toZodiac(lonT).name;
              const severity = ['saturn', 'uranus', 'neptune', 'pluto'].includes(b.key) ? 'high' : 'medium';

              allEvents.push({
                event_date: ed,
                event_type: 'ingress',
                planet: b.key,
                orb_degrees: 0,
                title: `${b.key} entra in ${newSign}`,
                description: `Il pianeta ${b.key} entra nel segno zodiacale ${newSign}.`,
                severity: severity,
                exact_timestamp: nd.toISOString()
              });
            }
          }
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

    // 8. Ordina per rilevanza
    const PRIORITY = {
      'pluto': 10, 'neptune': 9, 'uranus': 8, 'saturn': 7,
      'jupiter': 6, 'mars': 5, 'sun': 4, 'venus': 3,
      'mercury': 2, 'moon': 1
    };

    const highEvents = allEvents
      .filter(e => e.severity === 'high')
      .map(e => ({
        ...e,
        score: (PRIORITY[e.planet] || 0) +
          (e.aspect_type === 'opposizione' ? 5 :
           e.aspect_type === 'quadrato' ? 4 :
           e.aspect_type === 'congiunzione' ? 3 :
           e.event_type === 'planet_enters_house' ? 2 : 1)
      }))
      .sort((a, b) => b.score - a.score);

    const top3Events = highEvents.slice(0, 3);

    console.log(`Transiti: ${allEvents.length} eventi, ${highEvents.length} HIGH, top3: ${top3Events.length}`);

    // 9. Salva future_events in natal_charts (con gestione errori)
    if (supabase) {
      try {
        const futureEvents = highEvents.map(e => ({
          event_date: e.event_date,
          event_type: e.event_type,
          planet: e.planet,
          target_planet: e.target_planet || null,
          house: e.house || null,
          aspect_type: e.aspect_type,
          orb_degrees: e.orb_degrees,
          title: e.title,
          description: e.description,
          severity: e.severity
        }));

        const { error: updateErr } = await supabase
          .from('natal_charts')
          .update({
            future_events: futureEvents,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user_id);

        if (updateErr) {
          console.error('Errore salvataggio future_events:', updateErr.message);
        } else {
          console.log(`Salvati ${futureEvents.length} future_events`);
        }
      } catch (e) {
        console.error('DB error future_events:', e.message);
      }

      // 10. Salva top 3 in upcoming_events per Telegram
      if (top3Events.length > 0) {
        try {
          await supabase.from('upcoming_events').delete().eq('user_id', user_id);

          const upcoming = top3Events.map(e => ({
            user_id,
            event_date: e.event_date,
            notify_at: e.exact_timestamp,
            telegram_sent: false,
            title: e.title,
            description: e.description,
            severity: e.severity
          }));

          const { error: insErr } = await supabase.from('upcoming_events').insert(upcoming);
          if (insErr) {
            console.error('Errore upcoming_events:', insErr.message);
          } else {
            console.log(`Salvati ${upcoming.length} upcoming_events`);
          }
        } catch (e) {
          console.error('DB error upcoming_events:', e.message);
        }
      }
    }

    // 11. Risposta
    res.json({
      date: today.toISOString().split('T')[0],
      natal: {
        ascendant: Math.round(natal.ascendant * 100) / 100,
        ascendantSign: toZodiac(natal.ascendant).name,
        mc: Math.round(natal.mc * 100) / 100,
        mcSign: toZodiac(natal.mc).name,
      },
      transitsToday: daily,
      eventsFound: allEvents.length,
      highEventsFound: highEvents.length,
      top3ForTelegram: top3Events.length,
      message: 'Transiti calcolati e salvati'
    });

  } catch (err) {
    console.error('Transits FATAL error:', err);
    res.status(500).json({ error: err.message || 'Errore interno nei transiti' });
  }
});

// GET di test
app.get('/api/transits', (req, res) => {
  res.json({ status: 'Transits API attivo', use: 'POST /api/transits con body { user_id }' });
});

app.listen(PORT, () => {
  console.log(`Luna Astrologica API running on port ${PORT}`);
});
