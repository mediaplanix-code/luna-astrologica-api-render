// ============================================================
// RENDER SERVER -- Luna Astrologica API
// Swiss Ephemeris (swisseph npm) -- precisione professionale reale
// VERSIONE DEFENSIVA: gestisce tutti i casi limite senza crashare
// AGGIORNAMENTO: Dossier GPT-4 + Eventi Speciali + Context Giornaliero + Telegram
// Data: 2026-05-29
// ============================================================

require('dotenv').config(); // Sicuro: se non c'è .env, non fa nulla
const express = require('express');
const swisseph = require('swisseph');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ============================================
// CONFIGURAZIONE
// ============================================
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Configurazione Supabase con gestione errori
let supabase = null;
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log('Supabase client initialized');
  } else {
    console.error('⚠️  SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti nelle variabili d\'ambiente');
  }
} catch (e) {
  console.error('Supabase init failed:', e.message);
}

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

// ============================================
// HELPER: OpenAI GPT-4
// ============================================
async function callGPT4(systemPrompt, userPrompt, jsonMode = true) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY non configurata nelle variabili d\'ambiente');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: jsonMode ? { type: 'json_object' } : undefined,
      temperature: 0.75,
      max_tokens: 3000
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

// ============================================
// HELPER: Calcolo Tema Natale (riutilizzabile)
// ============================================
function calculateNatalChartReal(birthDate, birthTime, lat, lng, timezone) {
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
    throw new Error('Houses calculation failed');
  }

  const asc = houseResult.ascendant;
  const mc = houseResult.mc;

  const houses = [];
  for (let i = 0; i < 12; i++) {
    houses.push(toZodiac(houseResult.house[i]));
  }

  return {
    planets: planets.map(p => {
      const z = toZodiac(p.lon);
      return { key: p.key, sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol, longitude: p.lon };
    }),
    moonSign: moonLon ? toZodiac(moonLon).name : null,
    ascendant: toZodiac(asc),
    mc: toZodiac(mc),
    houses: houses,
    points: {
      ascendant: asc,
      mc: mc,
      moon_sign: moonLon
    },
    jd: jd
  };
}

// ============================================
// MIDDLEWARE: blocca se Supabase non è pronto
// ============================================
function requireSupabase(req, res, next) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Database non configurato. Controlla le variabili d\'ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel dashboard Render.' 
    });
  }
  next();
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

    const response = calculateNatalChartReal(birthDate, birthTime, lat, lng, timezone);

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
            points: response.points,
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
  res.json({ 
    status: 'ok', 
    engine: 'swiss-ephemeris', 
    precision: 'professional',
    openai: !!OPENAI_API_KEY,
    telegram: !!TELEGRAM_BOT_TOKEN
  });
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

// ============================================================
// NUOVI ENDPOINT — STEP 1: DOSSIER + EVENTI INTERPRETATI
// ============================================================

// ============================================
// POST /api/generate-dossier
// Genera il dossier astrologico interpretato via GPT-4 (una sola volta per utente)
// ============================================
app.post('/api/generate-dossier', requireSupabase, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio' });

    // 1. Recupera tema natale e profilo
    const { data: chart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .order('calculated_at', { ascending: false })
      .limit(1);
    
    if (chartErr || !chart || chart.length === 0) {
      console.error('Tema natale non trovato per user_id:', user_id, 'Errore:', chartErr);
      throw new Error('Tema natale non trovato per questo utente');
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('full_name, birth_date, birth_time, birth_city, birth_country, sun_sign, moon_sign, rising_sign, birth_latitude, birth_longitude, birth_timezone')
      .eq('id', user_id)
      .single();

    if (profErr) throw profErr;

    // 2. Se dossier già generato, restituisci cached
    if (chart.dossier_astrologico) {
      return res.json({ success: true, cached: true, dossier: chart.dossier_astrologico });
    }

    // 3. Se mancano i dati del tema natale, ricalcola con Swiss Ephemeris
    let chartData = chart;
    if (!chart.planets || chart.planets.length === 0) {
      if (profile.birth_date && profile.birth_latitude && profile.birth_longitude) {
        const calculated = calculateNatalChartReal(
          profile.birth_date,
          profile.birth_time,
          profile.birth_latitude,
          profile.birth_longitude,
          profile.birth_timezone
        );
        chartData = {
          planets: calculated.planets,
          houses: calculated.houses,
          aspects: [],
          points: calculated.points
        };
      } else {
        throw new Error('Dati di nascita incompleti per calcolare il tema natale');
      }
    }

    // 4. Prompt System per Luna (GPT-4)
    const systemPrompt = `Sei Luna, astrologa professionista italiana con 30 anni di esperienza.
Hai un approccio empatico, caldo e mai giudicante. Usi metafore concrete e linguaggio accessibile.
Devi analizzare un tema natale e produrre un DOSSIER ASTROLOGICO interpretativo strutturato in JSON.
Il dossier deve essere CITABILE da un'AI in chat: ogni sezione è un "blocco" di conoscenza autonomo.
Tono professionale ma umano, come una consulenza dal vivo.`;

    // 5. Prompt User con dati grezzi
    const userPrompt = `Cliente: ${profile.full_name || 'Utente'}
Nato il: ${profile.birth_date || 'N/D'} alle ${profile.birth_time || 'N/D'} a ${profile.birth_city || 'N/D'}, ${profile.birth_country || 'N/D'}
Segno Solare: ${profile.sun_sign || 'N/D'}, Lunare: ${profile.moon_sign || 'N/D'}, Ascendente: ${profile.rising_sign || 'N/D'}

DATI TEMA NATALE (grezzi):
Pianeti: ${JSON.stringify(chartData.planets, null, 2)}
Case: ${JSON.stringify(chartData.houses, null, 2)}
Aspetti: ${JSON.stringify(chartData.aspects || [], null, 2)}
Punti: ${JSON.stringify(chartData.points || {}, null, 2)}

Genera ESATTAMENTE questo JSON (nessun testo fuori dal JSON):

{
  "summary": "Paragrafo riassuntivo generale del tema natale, 4-5 righe, tono caldo e professionale",
  "essenza": "L'essenza psicologica e spirituale del nato, 3-4 righe, approccio profondo",
  "punti_forti": ["2-3 punti di forza astrologici, formulati in italiano discorsivo"],
  "punti_critici": ["2-3 aree di attenzione, formulate costruttivamente, mai allarmistiche"],
  "relazioni": "Interpretazione amore e relazioni, 3-4 righe, specifica per questo tema",
  "lavoro": "Interpretazione carriera e vocazione, 3-4 righe, indicazioni concrete",
  "salute": "Indicazioni su energia fisica e ritmi, 2-3 righe, approccio olistico",
  "pianeti_chiave": {
    "sole": {"segno": "...", "casa": N, "interpretazione": "2-3 righe specifiche"},
    "luna": {"segno": "...", "casa": N, "interpretazione": "2-3 righe specifiche"},
    "ascendente": {"segno": "...", "interpretazione": "2-3 righe specifiche"},
    "mercurio": {"segno": "...", "casa": N, "interpretazione": "2-3 righe specifiche"},
    "venere": {"segno": "...", "casa": N, "interpretazione": "2-3 righe specifiche"},
    "marte": {"segno": "...", "casa": N, "interpretazione": "2-3 righe specifiche"}
  },
  "aspetti_principali": [
    {"tipo": "congiunzione/trigono/quadratura/etc", "pianeta1": "...", "pianeta2": "...", "interpretazione": "2 righe specifiche per questo aspetto"}
  ],
  "case_sensibili": {
    "casa_1": "interpretazione specifica della Casa 1",
    "casa_7": "interpretazione specifica della Casa 7",
    "casa_10": "interpretazione specifica della Casa 10"
  },
  "transiti_sensibili": "Quali punti del tema sono più sensibili ai transiti futuri, 2 righe"
}`;

    // 6. Chiama GPT-4
    console.log(`[DOSSIER] Generazione dossier per utente ${user_id}...`);
    const gptResponse = await callGPT4(systemPrompt, userPrompt, true);
    const dossier = JSON.parse(gptResponse);

    // 7. Salva in natal_charts
    const { error: updErr } = await supabase
      .from('natal_charts')
      .update({
        dossier_astrologico: dossier,
        interpretation_text: dossier.summary,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user_id);

    if (updErr) throw updErr;

    // 8. Marca profilo
    await supabase
      .from('profiles')
      .update({ dossier_generated_at: new Date().toISOString() })
      .eq('id', user_id);

    console.log(`[DOSSIER] Completato per utente ${user_id}`);
    res.json({ success: true, dossier });

  } catch (err) {
    console.error('/api/generate-dossier error:', err);
    res.status(500).json({ error: err.message, details: err.stack });
  }
});

// ============================================
// POST /api/calculate-transits
// Calcola 90gg transiti REALI con Swiss Ephemeris, genera interpretazioni batch GPT-4 per eventi HIGH,
// aggiorna le "3 caselle" nel profilo (next_events)
// ============================================
app.post('/api/calculate-transits', requireSupabase, async (req, res) => {
  try {
    const { user_id, days = 90 } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio' });

    // 1. Recupera dati
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, birth_date, birth_time, birth_latitude, birth_longitude, birth_timezone, sun_sign, moon_sign, rising_sign')
      .eq('id', user_id)
      .single();

    if (profErr || !profile) throw new Error('Profilo non trovato');

    // 2. Calcolo tema natale reale
    const natalData = calculateNatalChartReal(
      profile.birth_date,
      profile.birth_time,
      profile.birth_latitude,
      profile.birth_longitude,
      profile.birth_timezone
    );

    const natal = {};
    natalData.planets.forEach(p => { natal[p.key] = p.longitude; });
    natal.houses = natalData.points.ascendant ? 
      Array.from({length: 12}, (_, i) => {
        const houseJD = natalData.jd;
        const houseResult = calcHousesSync(houseJD, profile.birth_latitude, profile.birth_longitude);
        return houseResult ? houseResult.house[i] : 0;
      }) : [];
    natal.ascendant = natalData.points.ascendant;
    natal.mc = natalData.points.mc;

    // 3. Calcola transiti 90 giorni (logica reale Swiss Ephemeris)
    const today = new Date();
    const allEvents = [];
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

    for (let i = 0; i < days; i++) {
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
              const orbVal = Number((Math.abs(diff - asp.angle)).toFixed(2));
              const severity = calcSeverity(tName, nName, orbVal, asp.name);

              allEvents.push({
                date: ed,
                planet: tName,
                target: nName,
                aspect: asp.name,
                house: null,
                orb: orbVal,
                severity: severity === 'high' ? 'HIGH' : severity === 'medium' ? 'MEDIUM' : 'LOW',
                title: `${tName} ${asp.name} ${nName} (Natale)`,
                description: `Il transito di ${tName} forma un ${asp.name} con ${nName} del tema natale. Orb: ${orbVal}°`
              });
            }
          }
        }
      }

      // Ingressi in case
      for (const [tName, tDeg] of Object.entries(trans)) {
        for (let h = 1; h <= 12; h++) {
          if (natal.houses[h - 1] && angleDiff(tDeg, natal.houses[h - 1]) < 1.0) {
            const ed = cur.toISOString().split('T')[0];
            const orbVal = Number(angleDiff(tDeg, natal.houses[h - 1]).toFixed(2));
            const severity = calcSeverity(tName, null, orbVal, 'ingresso');

            allEvents.push({
              date: ed,
              planet: tName,
              target: `Casa ${h}`,
              aspect: 'ingresso',
              house: h,
              orb: orbVal,
              severity: severity === 'high' ? 'HIGH' : severity === 'medium' ? 'MEDIUM' : 'LOW',
              title: `${tName} entra in Casa ${h}`,
              description: `Il pianeta ${tName} entra nella Casa ${h} del tema natale.`
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
              const newSign = toZodiac(lonT).name;
              const severity = ['saturn', 'uranus', 'neptune', 'pluto'].includes(b.key) ? 'HIGH' : 'MEDIUM';

              allEvents.push({
                date: ed,
                planet: b.key,
                target: newSign,
                aspect: 'cambio segno',
                house: null,
                orb: 0,
                severity: severity,
                title: `${b.key} entra in ${newSign}`,
                description: `Il pianeta ${b.key} entra nel segno zodiacale ${newSign}.`
              });
            }
          }
        }
      }
    }

    // 4. Filtra solo HIGH e ordina
    const highEvents = allEvents
      .filter(e => e.severity === 'HIGH')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 12);

    // 5. Se ci sono eventi HIGH, genera interpretazioni batch GPT-4
    if (highEvents.length > 0 && OPENAI_API_KEY) {
      const { data: chart } = await supabase
        .from('natal_charts')
        .select('dossier_astrologico')
        .eq('user_id', user_id)
        .single();

      const dossierSummary = chart?.dossier_astrologico?.summary || 'Tema natale disponibile';

      const systemPrompt = `Sei Luna, astrologa professionista italiana.
Devi interpretare eventi astrologici futuri per un cliente specifico.
Per ogni evento, genera tre campi:
- interpretation_ai: come parlarne al cliente, discorsivo, personale, 2-3 righe
- consiglio_difesa: azione concreta, pratica, non esoterica, 1-2 righe
- telegram_message_text: breve messaggio per Telegram, max 350 caratteri, tono empatico, con CTA finale verso la chat a pagamento
Restituisci SEMPRE un JSON array esatto.`;

      const userPrompt = `Cliente: ${profile.full_name || 'Utente'} (Segno Solare: ${profile.sun_sign || 'N/D'})
Dossier riassunto: ${dossierSummary}

Eventi dei prossimi ${days} giorni:
${JSON.stringify(highEvents, null, 2)}

Restituisci ESATTAMENTE questo JSON:
{
  "interpretations": [
    {
      "event_index": 0,
      "interpretation_ai": "come parlarne al cliente...",
      "consiglio_difesa": "azione concreta...",
      "telegram_message_text": "⚡ Tra X giorni... [testo breve e personale] Scopri di più con Luna → https://luna-astrologica.pages.dev/chat"
    }
  ]
}`;

      console.log(`[TRANSITS] Generazione interpretazioni batch per ${highEvents.length} eventi...`);
      const gptRaw = await callGPT4(systemPrompt, userPrompt, true);
      const gptData = JSON.parse(gptRaw);

      // 6. Prepara eventi per upcoming_events con interpretazioni
      const eventsToInsert = highEvents.map((evt, idx) => {
        const interp = gptData.interpretations?.[idx] || {};
        const eventDate = new Date(evt.date);
        const notifyAt = new Date(eventDate);
        notifyAt.setDate(notifyAt.getDate() - 5);

        return {
          user_id,
          event_type: evt.title || `${evt.planet} ${evt.aspect} ${evt.target}`,
          severity: evt.severity,
          planet: evt.planet,
          target: evt.target,  // <-- era target_planet, ma il DB ha "target"
          house: evt.house,
          aspect_type: evt.aspect,
          event_date: evt.date,
          exact_timestamp: evt.date,
          orb: evt.orb,  // <-- era orb_degrees, ma il DB ha "orb"
          description: evt.description || '',
          advice: interp.consiglio_difesa || '',
          interpretation_ai: interp.interpretation_ai || '',
          consiglio_difesa: interp.consiglio_difesa || '',
          telegram_message_text: interp.telegram_message_text || '',
          notify_at: notifyAt.toISOString().split('T')[0],
          is_notified: false,
          telegram_sent: false,
          created_at: new Date().toISOString()
        };
      });

      // 7. Cancella vecchi upcoming_events e inserisci nuovi
      const { error: delErr } = await supabase
        .from('upcoming_events')
        .delete()
        .eq('user_id', user_id);
      if (delErr) console.error('Errore cancellazione vecchi eventi:', delErr);

      const { error: insErr } = await supabase
        .from('upcoming_events')
        .insert(eventsToInsert);
      if (insErr) throw new Error(`Inserimento upcoming_events fallito: ${insErr.message}`);
    } else if (highEvents.length > 0 && !OPENAI_API_KEY) {
      // Se non c'è OpenAI, salva eventi senza interpretazioni
      const eventsToInsert = highEvents.map((evt) => {
        const eventDate = new Date(evt.date);
        const notifyAt = new Date(eventDate);
        notifyAt.setDate(notifyAt.getDate() - 5);

        return {
          user_id,
          event_type: evt.title,
          severity: evt.severity,
          planet: evt.planet,
          target_planet: evt.target,
          house: evt.house,
          aspect_type: evt.aspect,
          event_date: evt.date,
          exact_timestamp: evt.date,
          orb_degrees: evt.orb,
          title: evt.title,
          description: evt.description,
          notify_at: notifyAt.toISOString().split('T')[0],
          is_notified: false,
          telegram_sent: false,
          created_at: new Date().toISOString()
        };
      });

      await supabase.from('upcoming_events').delete().eq('user_id', user_id);
      const { error: insErr } = await supabase.from('upcoming_events').insert(eventsToInsert);
      if (insErr) console.error('Errore inserimento upcoming_events (no GPT):', insErr.message);
    }

    // 8. Aggiorna le "3 caselle" nel profilo (next_events)
    const { data: top3 } = await supabase
      .from('upcoming_events')
      .select('*')
      .eq('user_id', user_id)
      .eq('severity', 'HIGH')
      .order('event_date', { ascending: true })
      .limit(3);

    const nextEventsPayload = (top3 || []).map(e => ({
      event_id: e.id,
      event_date: e.event_date,
      title: e.event_type || e.title || '',  // <-- il DB non ha "title", usa event_type
      description: e.description || '',
      interpretation_ai: e.interpretation_ai,
      consiglio_difesa: e.consiglio_difesa,
      telegram_message_text: e.telegram_message_text,
      notify_at: e.notify_at,
      telegram_sent: e.telegram_sent,
      severity: e.severity
    }));

    const { error: updProfErr } = await supabase
      .from('profiles')
      .update({
        next_events: nextEventsPayload,
        updated_at: new Date().toISOString()
      })
      .eq('id', user_id);
    if (updProfErr) throw updProfErr;

    // 9. Genera/Salva daily_transits per OGGI (template, no GPT-4)
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: existingDaily } = await supabase
      .from('daily_transits')
      .select('id')
      .eq('user_id', user_id)
      .eq('transit_date', todayStr)
      .single();

    if (!existingDaily) {
      const sunSign = profile.sun_sign || 'il tuo segno';
      const dailyHoroscope = `🌙 Oggi il cielo parla a ${profile.full_name || 'te'} con la voce dei transiti. ` +
        `Per chi ha il Sole in ${sunSign}, è un giorno di ascolto interiore. ` +
        `I pianeti in movimento suggeriscono attenzione alle dinamiche relazionali e alla chiarezza comunicativa. ` +
        `Non forzare i tempi: Luna ci ricorda che ogni seme ha il suo momento di germogliare.`;

      const { error: dailyErr } = await supabase
        .from('daily_transits')
        .insert({
          user_id,
          transit_date: todayStr,
          transit_planets: { note: 'transiti attivi oggi' },
          active_aspects: [],
          activated_houses: [],
          intensity_score: 5,
          daily_horoscope_text: dailyHoroscope,
          interpretation_ai: dailyHoroscope,
          consiglio_pratico: 'Prenditi 10 minuti di silenzio questa mattina. Scrivi tre parole che descrivono come ti senti.',
          created_at: new Date().toISOString()
        });
      if (dailyErr) console.error('Errore inserimento daily_transits:', dailyErr);
    }

    res.json({
      success: true,
      events_calculated: highEvents.length,
      next_3_events: nextEventsPayload,
      message: 'Transiti calcolati e interpretazioni generate con successo'
    });

  } catch (err) {
    console.error('/api/calculate-transits error:', err);
    res.status(500).json({ error: err.message, details: err.stack });
  }
});

// ============================================
// POST /api/get-daily-context
// Usato dal frontend ad ogni ingresso utente.
// Restituisce: daily_transits di oggi + next_events + crediti + dossier flag
// ============================================
app.post('/api/get-daily-context', requireSupabase, async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio' });

    const today = new Date().toISOString().split('T')[0];

    // 1. Recupera o crea daily_transits per oggi
    let { data: daily, error: dailyErr } = await supabase
      .from('daily_transits')
      .select('*')
      .eq('user_id', user_id)
      .eq('transit_date', today)
      .single();

    if (!daily) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, sun_sign')
        .eq('id', user_id)
        .single();

      const fallbackHoroscope = `🌙 Luna ti accoglie oggi. ` +
        `Il cielo è in movimento e ogni transito porta un messaggio. ` +
        `Entra in chat per scoprire cosa significa per te oggi.`;

      const insertData = {
        user_id,
        transit_date: today,
        transit_planets: {},
        active_aspects: [],
        activated_houses: [],
        intensity_score: 3,
        daily_horoscope_text: fallbackHoroscope,
        interpretation_ai: fallbackHoroscope,
        consiglio_pratico: 'Respira profondamente tre volte prima di iniziare la giornata.',
        created_at: new Date().toISOString()
      };

      const { data: newDaily, error: newErr } = await supabase
        .from('daily_transits')
        .insert(insertData)
        .select()
        .single();

      if (!newErr) daily = newDaily;
    }

    // 2. Recupera profilo con next_events e crediti
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('next_events, credits, dossier_generated_at, full_name, sun_sign, telegram_chat_id, daily_horoscope_enabled')
      .eq('id', user_id)
      .single();

    if (profErr) throw profErr;

    // 3. Recupera dossier (se generato)
    const { data: chart } = await supabase
      .from('natal_charts')
      .select('dossier_astrologico')
      .eq('user_id', user_id)
      .single();

    res.json({
      success: true,
      daily: daily || null,
      profile_context: {
        full_name: profile.full_name,
        sun_sign: profile.sun_sign,
        credits: profile.credits,
        dossier_generated: !!profile.dossier_generated_at,
        next_events: profile.next_events || [],
        telegram_connected: !!profile.telegram_chat_id,
        daily_horoscope_enabled: profile.daily_horoscope_enabled
      },
      dossier_summary: chart?.dossier_astrologico?.summary || null
    });

  } catch (err) {
    console.error('/api/get-daily-context error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/cron/daily
// Chiamato da cron-job.org ogni mattina (es. 8:00 CET)
// Invia oroscopo giornaliero + eventi speciali via Telegram
// ============================================
app.get('/api/cron/daily', async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: 'Telegram non configurato (manca TELEGRAM_BOT_TOKEN)' });
    }
    if (!supabase) {
      return res.status(503).json({ error: 'Database non configurato' });
    }

    const today = new Date().toISOString().split('T')[0];
    const results = { horoscopes: 0, events: 0, errors: [] };

    // --- A. Invio oroscopo giornaliero ---
    const { data: users, error: usersErr } = await supabase
      .from('profiles')
      .select('id, full_name, telegram_chat_id, daily_horoscope_enabled, last_horoscope_sent, sun_sign')
      .eq('daily_horoscope_enabled', true)
      .not('telegram_chat_id', 'is', null);

    if (usersErr) throw usersErr;

    for (const user of users || []) {
      if (user.last_horoscope_sent === today) continue;

      const { data: daily } = await supabase
        .from('daily_transits')
        .select('daily_horoscope_text')
        .eq('user_id', user.id)
        .eq('transit_date', today)
        .single();

      let horoscopeText = daily?.daily_horoscope_text;
      if (!horoscopeText) {
        horoscopeText = `🌙 Buongiorno ${user.full_name || ''}! ` +
          `Oggi il cielo ha un messaggio per te. ` +
          `Entra in chat con Luna per scoprire cosa dicono i pianeti → https://luna-astrologica.pages.dev`;
      } else if (!horoscopeText.includes('luna-astrologica')) {
        horoscopeText += `\n\n🌙 La tua astrologa Luna ti aspetta in chat → https://luna-astrologica.pages.dev/chat`;
      }

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegram_chat_id,
            text: horoscopeText,
            parse_mode: 'HTML'
          })
        });

        if (!tgRes.ok) throw new Error('Telegram API error');

        await supabase
          .from('profiles')
          .update({ last_horoscope_sent: today })
          .eq('id', user.id);

        results.horoscopes++;
      } catch (e) {
        console.error(`[CRON] Horoscope failed for ${user.id}:`, e.message);
        results.errors.push({ user: user.id, type: 'horoscope', error: e.message });
      }
    }

    // --- B. Invio eventi speciali (con 5gg anticipo, max 3/mese per utente) ---
    const { data: upcoming, error: upErr } = await supabase
      .from('upcoming_events')
      .select('*, profiles!inner(telegram_chat_id, last_event_notification)')
      .eq('severity', 'HIGH')
      .eq('telegram_sent', false)
      .lte('notify_at', today)
      .not('profiles.telegram_chat_id', 'is', null);

    if (upErr) throw upErr;

    for (const evt of upcoming || []) {
      const chatId = evt.profiles?.telegram_chat_id;
      if (!chatId || !evt.telegram_message_text) continue;

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: evt.telegram_message_text,
            parse_mode: 'HTML'
          })
        });

        if (!tgRes.ok) throw new Error('Telegram API error');

        await supabase
          .from('upcoming_events')
          .update({
            telegram_sent: true,
            notification_sent_at: new Date().toISOString()
          })
          .eq('id', evt.id);

        await supabase
          .from('profiles')
          .update({ last_event_notification: today })
          .eq('id', evt.user_id);

        results.events++;
      } catch (e) {
        console.error(`[CRON] Event notification failed for ${evt.user_id}:`, e.message);
        results.errors.push({ user: evt.user_id, type: 'event', error: e.message });
      }
    }

    res.json({
      success: true,
      date: today,
      horoscopes_sent: results.horoscopes,
      events_sent: results.events,
      errors: results.errors.length > 0 ? results.errors : undefined
    });

  } catch (err) {
    console.error('/api/cron/daily error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Luna Astrologica API running on port ${PORT}`);
  console.log(`🤖 OpenAI: ${OPENAI_API_KEY ? 'OK' : 'NON CONFIGURATO'}`);
  console.log(`✈️  Telegram: ${TELEGRAM_BOT_TOKEN ? 'OK' : 'NON CONFIGURATO'}`);
});
