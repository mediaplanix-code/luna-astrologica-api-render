// ============================================================
// LUNA ASTROLOGICA API -- VERSIONE CORRETTA PER SCHEMA ATTUALE
// Node.js + Express + Swiss Ephemeris (swisseph npm)
// Popola natal_charts + user_reports.report_data (JSONB identikit_natale)
// ============================================================

const express = require('express');
const swisseph = require('swisseph');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Configurazione Supabase
let supabase = null;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log('✅ Supabase client initialized');
} catch (e) {
  console.error('❌ Supabase init failed:', e.message);
}

const PORT = process.env.PORT || 3000;

// ============================================================
// COSTANTI
// ============================================================
const ZODIAC = [
  { name: 'Ariete', symbol: '♈', element: 'Fuoco', modality: 'Cardinale' },
  { name: 'Toro', symbol: '♉', element: 'Terra', modality: 'Fisso' },
  { name: 'Gemelli', symbol: '♊', element: 'Aria', modality: 'Mutabile' },
  { name: 'Cancro', symbol: '♋', element: 'Acqua', modality: 'Cardinale' },
  { name: 'Leone', symbol: '♌', element: 'Fuoco', modality: 'Fisso' },
  { name: 'Vergine', symbol: '♍', element: 'Terra', modality: 'Mutabile' },
  { name: 'Bilancia', symbol: '♎', element: 'Aria', modality: 'Cardinale' },
  { name: 'Scorpione', symbol: '♏', element: 'Acqua', modality: 'Fisso' },
  { name: 'Sagittario', symbol: '♐', element: 'Fuoco', modality: 'Mutabile' },
  { name: 'Capricorno', symbol: '♑', element: 'Terra', modality: 'Cardinale' },
  { name: 'Acquario', symbol: '♒', element: 'Aria', modality: 'Fisso' },
  { name: 'Pesci', symbol: '♓', element: 'Acqua', modality: 'Mutabile' }
];

const PLANET_NAMES = {
  sun: 'Sole', moon: 'Luna', mercury: 'Mercurio', venus: 'Venere',
  mars: 'Marte', jupiter: 'Giove', saturn: 'Saturno', uranus: 'Urano',
  neptune: 'Nettuno', pluto: 'Plutone', mean_node: 'Nodo Nord',
  chiron: 'Chiron', lilith: 'Lilith', part_of_fortune: 'Parte di Fortuna'
};

const RULERS = {
  'Ariete': 'Marte', 'Toro': 'Venere', 'Gemelli': 'Mercurio',
  'Cancro': 'Luna', 'Leone': 'Sole', 'Vergine': 'Mercurio',
  'Bilancia': 'Venere', 'Scorpione': 'Plutone', 'Sagittario': 'Giove',
  'Capricorno': 'Saturno', 'Acquario': 'Urano', 'Pesci': 'Nettuno'
};

// ============================================================
// FUNZIONI DI UTILITÀ
// ============================================================

function toZodiac(deg) {
  const d = ((deg % 360) + 360) % 360;
  const idx = Math.floor(d / 30) % 12;
  const z = ZODIAC[idx];
  return {
    name: z.name,
    symbol: z.symbol,
    element: z.element,
    modality: z.modality,
    degree: Math.floor(d % 30),
    minutes: Math.floor(((d % 30) % 1) * 60),
    totalDegrees: d
  };
}

function getSignName(deg) {
  return toZodiac(deg).name;
}

function getElement(signName) {
  const z = ZODIAC.find(z => z.name === signName);
  return z ? z.element : null;
}

function getModality(signName) {
  const z = ZODIAC.find(z => z.name === signName);
  return z ? z.modality : null;
}

function angleDiff(a, b) {
  let diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

function calcPlanetSync(jd, planetId) {
  try {
    const result = swisseph.swe_calc_ut(jd, planetId, swisseph.SEFLG_SPEED);
    if (result.error) {
      console.warn('Calc error:', result.error);
      return null;
    }
    return {
      longitude: result.longitude,
      latitude: result.latitude,
      distance: result.distance,
      speed: result.speed,
      speedLongitude: result.speedLongitude
    };
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

function getHistoricalOffset(timezone, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const monthDay = month * 100 + day;

  if (timezone === 'Europe/Rome' || timezone === 'Europe/Paris') {
    if (year < 1916) return 0;
    if (year >= 1916 && year <= 1965) {
      return (monthDay >= 325 && monthDay <= 926) ? 2 : 1;
    }
    if (year >= 1966 && year <= 1970) {
      return (monthDay >= 327 && monthDay <= 926) ? 2 : 1;
    }
    if (year >= 1971 && year <= 1979) {
      return (monthDay >= 325 && monthDay <= 924) ? 2 : 1;
    }
    return (monthDay >= 325 && monthDay <= 1026) ? 2 : 1;
  }

  if (timezone === 'Europe/London') {
    return (monthDay >= 325 && monthDay <= 1026) ? 1 : 0;
  }

  if (timezone === 'America/New_York') {
    return (monthDay >= 310 && monthDay <= 1103) ? -4 : -5;
  }

  if (timezone && timezone.startsWith('Etc/GMT')) {
    const match = timezone.match(/GMT([+-]?\d+)/);
    if (match) return parseInt(match[1]);
  }

  return 1;
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

// ============================================================
// CALCOLO COMPLETO TEMA NATALE
// ============================================================

function calculateNatalChart(birthDate, birthTime, lat, lng, timezone) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const timeParts = (birthTime || '12:00').split(':');
  const hour = parseInt(timeParts[0]) || 12;
  const minute = parseInt(timeParts[1]) || 0;

  const tzOffset = getHistoricalOffset(timezone, birthDate);
  const utHour = hour - tzOffset + (minute / 60);
  const jd = swisseph.swe_julday(year, month, day, utHour, swisseph.SE_GREG_CAL);

  // 1. PIANETI PRINCIPALI
  const mainBodies = [
    { key: 'sun', id: swisseph.SE_SUN },
    { key: 'moon', id: swisseph.SE_MOON },
    { key: 'mercury', id: swisseph.SE_MERCURY },
    { key: 'venus', id: swisseph.SE_VENUS },
    { key: 'mars', id: swisseph.SE_MARS },
    { key: 'jupiter', id: swisseph.SE_JUPITER },
    { key: 'saturn', id: swisseph.SE_SATURN },
    { key: 'uranus', id: swisseph.SE_URANUS },
    { key: 'neptune', id: swisseph.SE_NEPTUNE },
    { key: 'pluto', id: swisseph.SE_PLUTO }
  ];

  const planets = {};
  let sunLon = null, moonLon = null;

  for (const b of mainBodies) {
    const res = calcPlanetSync(jd, b.id);
    if (res) {
      const z = toZodiac(res.longitude);
      planets[b.key] = {
        sign: z.name,
        degree: z.degree,
        minutes: z.minutes,
        symbol: z.symbol,
        longitude: res.longitude,
        latitude: res.latitude,
        distance: res.distance,
        speed: res.speed,
        retrograde: res.speedLongitude < 0,
        element: z.element,
        modality: z.modality
      };
      if (b.key === 'sun') sunLon = res.longitude;
      if (b.key === 'moon') moonLon = res.longitude;
    }
  }

  // 2. CASE (Placidus)
  const houseResult = calcHousesSync(jd, lat, lng);
  if (!houseResult) {
    throw new Error('Calcolo case fallito');
  }

  const houses = {};
  const houseCusps = [];
  for (let i = 1; i <= 12; i++) {
    const cusp = houseResult.house[i - 1];
    const z = toZodiac(cusp);
    houses[i] = {
      sign: z.name,
      degree: z.degree,
      minutes: z.minutes,
      symbol: z.symbol,
      cusp_longitude: cusp,
      element: z.element,
      modality: z.modality
    };
    houseCusps.push(cusp);
  }

  const ascLon = houseResult.ascendant;
  const mcLon = houseResult.mc;
  const ascZ = toZodiac(ascLon);
  const mcZ = toZodiac(mcLon);

  // 3. DETERMINARE CASA DI OGNI PIANETA
  function getHouse(deg) {
    for (let i = 1; i <= 12; i++) {
      let start = houseCusps[i - 1];
      let end = houseCusps[i % 12];
      let check = deg;
      if (start > end) {
        if (check < start) check += 360;
        end += 360;
      }
      if (check >= start && check < end) return i;
    }
    return 1;
  }

  for (const key of Object.keys(planets)) {
    planets[key].house = getHouse(planets[key].longitude);
  }

  // 4. PUNTI AGGIUNTIVI
  const points = {};

  // Nodo Medio (Mean Node)
  try {
    const nodeRes = calcPlanetSync(jd, swisseph.SE_MEAN_NODE);
    if (nodeRes) {
      const z = toZodiac(nodeRes.longitude);
      points.mean_node = {
        sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol,
        longitude: nodeRes.longitude, house: getHouse(nodeRes.longitude),
        retrograde: nodeRes.speedLongitude < 0, element: z.element, modality: z.modality
      };
    }
  } catch (e) { console.warn('Nodo calcolo fallito:', e.message); }

  // Chiron (ID 15 in swisseph)
  try {
    const chironRes = calcPlanetSync(jd, 15);
    if (chironRes) {
      const z = toZodiac(chironRes.longitude);
      points.chiron = {
        sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol,
        longitude: chironRes.longitude, house: getHouse(chironRes.longitude),
        retrograde: chironRes.speedLongitude < 0, element: z.element, modality: z.modality
      };
    }
  } catch (e) { console.warn('Chiron calcolo fallito:', e.message); }

  // Parte di Fortuna = Asc + Luna - Sole
  if (sunLon !== null && moonLon !== null) {
    const pofLon = normalizeDeg(ascLon + moonLon - sunLon);
    const z = toZodiac(pofLon);
    points.part_of_fortune = {
      sign: z.name, degree: z.degree, minutes: z.minutes, symbol: z.symbol,
      longitude: pofLon, house: getHouse(pofLon), element: z.element, modality: z.modality
    };
  }

  // Ascendente e MC come punti
  points.ascendant = {
    sign: ascZ.name, degree: ascZ.degree, minutes: ascZ.minutes, symbol: ascZ.symbol,
    longitude: ascLon, house: 1, element: ascZ.element, modality: ascZ.modality
  };
  points.mc = {
    sign: mcZ.name, degree: mcZ.degree, minutes: mcZ.minutes, symbol: mcZ.symbol,
    longitude: mcLon, house: 10, element: mcZ.element, modality: mcZ.modality
  };

  // 5. ASPETTI NATALI
  const ASPECTS = [
    { name: 'congiunzione', angle: 0, orb: 8, major: true },
    { name: 'sestile', angle: 60, orb: 6, major: false },
    { name: 'quadrato', angle: 90, orb: 6, major: true },
    { name: 'trigono', angle: 120, orb: 6, major: true },
    { name: 'opposizione', angle: 180, orb: 6, major: true }
  ];

  const allBodies = { ...planets };
  if (points.mean_node) allBodies.mean_node = points.mean_node;
  if (points.chiron) allBodies.chiron = points.chiron;

  const aspects = [];
  const bodyKeys = Object.keys(allBodies);

  for (let i = 0; i < bodyKeys.length; i++) {
    for (let j = i + 1; j < bodyKeys.length; j++) {
      const k1 = bodyKeys[i];
      const k2 = bodyKeys[j];
      const lon1 = allBodies[k1].longitude;
      const lon2 = allBodies[k2].longitude;

      for (const asp of ASPECTS) {
        const diff = angleDiff(lon1, lon2);
        const orb = Math.abs(diff - asp.angle);
        const maxOrb = (k1 === 'sun' || k1 === 'moon' || k2 === 'sun' || k2 === 'moon') ? 8 : asp.orb;

        if (orb <= maxOrb) {
          const applying = (lon1 < lon2) === (allBodies[k1].speed < allBodies[k2].speed);
          aspects.push({
            planet1: k1,
            planet2: k2,
            aspect: asp.name,
            angle: asp.angle,
            orb: Number(orb.toFixed(2)),
            applying: applying,
            major: asp.major
          });
        }
      }
    }
  }

  aspects.sort((a, b) => {
    if (a.major && !b.major) return -1;
    if (!a.major && b.major) return 1;
    return a.orb - b.orb;
  });

  // 6. DOMINANTI
  const elementCount = { Fuoco: 0, Terra: 0, Aria: 0, Acqua: 0 };
  const modalityCount = { Cardinale: 0, Fisso: 0, Mutabile: 0 };

  for (const key of Object.keys(planets)) {
    const p = planets[key];
    if (elementCount[p.element] !== undefined) elementCount[p.element]++;
    if (modalityCount[p.modality] !== undefined) modalityCount[p.modality]++;
  }
  // Aggiungi ascendente
  if (elementCount[ascZ.element] !== undefined) elementCount[ascZ.element]++;
  if (modalityCount[ascZ.modality] !== undefined) modalityCount[ascZ.modality]++;

  const dominantElement = Object.entries(elementCount).sort((a, b) => b[1] - a[1])[0][0];
  const dominantModality = Object.entries(modalityCount).sort((a, b) => b[1] - a[1])[0][0];
  const ruler = RULERS[ascZ.name] || null;

  const dominant = {
    element: dominantElement,
    modality: dominantModality,
    ruler: ruler,
    element_count: elementCount,
    modality_count: modalityCount
  };

  return {
    planets,
    houses,
    points,
    aspects,
    dominant,
    ascendant: points.ascendant,
    mc: points.mc,
    house_system: 'Placidus',
    zodiac_type: 'Tropic',
    calculation_engine: 'swisseph',
    calculated_at: new Date().toISOString(),
    julian_day: jd
  };
}

// ============================================================
// COSTRUZIONE JSONB REPORT
// ============================================================

function buildIdentikitNatale(natalData, profile) {
  return {
    version: '1.0',
    calculated_at: natalData.calculated_at,
    source: 'swiss_ephemeris',
    subject: {
      name: profile.full_name || null,
      birth_date: profile.birth_date,
      birth_time: profile.birth_time || null,
      birth_city: profile.birth_city,
      birth_nation: profile.birth_country || profile.country || null,
      latitude: profile.birth_latitude ? Number(profile.birth_latitude) : null,
      longitude: profile.birth_longitude ? Number(profile.birth_longitude) : null,
      timezone: profile.birth_timezone || null,
      gender: profile.gender || null
    },
    planets: natalData.planets,
    houses: natalData.houses,
    aspects: natalData.aspects,
    points: natalData.points,
    dominant: natalData.dominant,
    house_system: natalData.house_system,
    zodiac_type: natalData.zodiac_type,
    calculation_engine: natalData.calculation_engine,
    ai_summary: null
  };
}

// ============================================================
// SALVATAGGIO DATABASE
// ============================================================

async function saveNatalChart(userId, natalData) {
  if (!supabase) throw new Error('Supabase non disponibile');

  const { error } = await supabase
    .from('natal_charts')
    .upsert({
      user_id: userId,
      planets: natalData.planets,
      houses: natalData.houses,
      aspects: natalData.aspects,
      points: natalData.points,
      house_system: natalData.house_system,
      zodiac_type: natalData.zodiac_type,
      calculation_engine: natalData.calculation_engine,
      is_verified: false,
      calculated_at: natalData.calculated_at
    }, { onConflict: 'user_id' });

  if (error) throw new Error(`Errore salvataggio natal_charts: ${error.message}`);
  return true;
}

async function saveUserReportNatal(userId, identikitNatale) {
  if (!supabase) throw new Error('Supabase non disponibile');

  const title = identikitNatale.subject.name
    ? `Tema Natale di ${identikitNatale.subject.name}`
    : 'Tema Natale';

  const { error } = await supabase
    .from('user_reports')
    .upsert({
      user_id: userId,
      report_type: 'natal',
      title: title,
      report_date: identikitNatale.subject.birth_date,
      period_start: null,
      period_end: null,
      report_data: { identikit_natale: identikitNatale },
      model_version: null,
      voice_synthesis: false,
      voice_url: null,
      credits_used: 0,
      is_favorite: false,
      user_notes: null
    }, { onConflict: 'user_id,report_type,report_date' });

  if (error) throw new Error(`Errore salvataggio user_reports: ${error.message}`);
  return true;
}

async function updateProfileCoords(userId, lat, lng, timezone) {
  if (!supabase) return;

  const updates = {};
  if (lat !== null) updates.birth_latitude = lat;
  if (lng !== null) updates.birth_longitude = lng;
  if (timezone) updates.birth_timezone = timezone;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId);

  if (error) console.error('Errore aggiornamento coordinate profilo:', error.message);
}

// ============================================================
// ENDPOINT: CALCOLO TEMA NATALE + POPOLAMENTO REPORT JSONB
// ============================================================

app.post('/api/natal-chart/calculate', async (req, res) => {
  try {
    const { user_id, birthDate, birthTime, lat, lng, timezone, city, country } = req.body;

    if (!user_id || !birthDate) {
      return res.status(400).json({ error: 'user_id e birthDate sono obbligatori' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database non disponibile' });
    }

    // 1. Leggi profilo
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (profileErr || !profile) {
      return res.status(404).json({ error: 'Profilo non trovato' });
    }

    // 2. Determina coordinate e timezone
    let useLat = lat !== undefined ? Number(lat) : null;
    let useLng = lng !== undefined ? Number(lng) : null;
    let useTz = timezone || profile.birth_timezone || null;
    const useCity = city || profile.birth_city || null;
    const useCountry = country || profile.birth_country || profile.country || null;

    // Se mancano coordinate, prova geocodifica
    if (useLat === null || useLng === null || useLat === 0 || useLng === 0) {
      if (useCity) {
        try {
          const query = encodeURIComponent(useCity + ',' + (useCountry || ''));
          const geoData = await safeFetchJson(
            `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`,
            { headers: { 'User-Agent': 'LunaAstrologica/1.0' } }
          );
          if (geoData && geoData.length > 0) {
            useLat = parseFloat(geoData[0].lat);
            useLng = parseFloat(geoData[0].lon);
          }
        } catch (e) {
          console.warn('Geocodifica fallita:', e.message);
        }
      }
    }

    if (useLat === null || useLng === null) {
      return res.status(400).json({ error: 'Coordinate geografiche mancanti. Inserisci città di nascita.' });
    }

    // Se manca timezone, deduci da paese
    if (!useTz) {
      const COUNTRY_TZ = {
        'IT': 'Europe/Rome', 'FR': 'Europe/Paris', 'ES': 'Europe/Madrid',
        'DE': 'Europe/Berlin', 'UK': 'Europe/London', 'GB': 'Europe/London',
        'US': 'America/New_York', 'CA': 'America/Toronto', 'AU': 'Australia/Sydney',
        'BR': 'America/Sao_Paulo', 'AR': 'America/Argentina/Buenos_Aires',
        'JP': 'Asia/Tokyo', 'IN': 'Asia/Kolkata', 'CN': 'Asia/Shanghai', 'RU': 'Europe/Moscow'
      };
      const countryUpper = (useCountry || '').toUpperCase();
      if (COUNTRY_TZ[countryUpper]) {
        useTz = COUNTRY_TZ[countryUpper];
      } else {
        const tzOffset = Math.round(useLng / 15);
        useTz = `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`;
      }
    }

    // Aggiorna profilo se necessario
    await updateProfileCoords(user_id, useLat, useLng, useTz);

    // 3. Calcola tema natale
    const natalData = calculateNatalChart(birthDate, birthTime || profile.birth_time, useLat, useLng, useTz);

    // 4. Salva in natal_charts
    await saveNatalChart(user_id, natalData);

    // 5. Costruisci e salva identikit in user_reports
    const identikit = buildIdentikitNatale(natalData, profile);
    await saveUserReportNatal(user_id, identikit);

    // 6. Risposta
    res.json({
      success: true,
      message: 'Tema natale calcolato e salvato',
      chart: {
        ascendant: natalData.ascendant,
        mc: natalData.mc,
        sun_sign: natalData.planets.sun ? natalData.planets.sun.sign : null,
        moon_sign: natalData.planets.moon ? natalData.planets.moon.sign : null,
        dominant_element: natalData.dominant.element,
        dominant_modality: natalData.dominant.modality,
        ruler: natalData.dominant.ruler,
        planets_count: Object.keys(natalData.planets).length,
        aspects_count: natalData.aspects.length,
        points_count: Object.keys(natalData.points).length
      }
    });

  } catch (err) {
    console.error('Natal chart calculate error:', err);
    res.status(500).json({ error: err.message || 'Errore interno nel calcolo del tema natale' });
  }
});

// ============================================================
// ENDPOINT LEGACY: /api/natal-chart (mantenuto per compatibilità)
// ============================================================

app.post('/api/natal-chart', async (req, res) => {
  try {
    const { birthDate, birthTime, lat, lng, timezone, user_id } = req.body;
    if (!birthDate || lat == null || lng == null) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const natalData = calculateNatalChart(birthDate, birthTime || '12:00', Number(lat), Number(lng), timezone || 'Europe/Rome');

    const response = {
      planets: Object.entries(natalData.planets).map(([key, p]) => ({
        key, sign: p.sign, degree: p.degree, minutes: p.minutes, symbol: p.symbol,
        house: p.house, retrograde: p.retrograde, longitude: p.longitude
      })),
      moonSign: natalData.planets.moon ? natalData.planets.moon.sign : null,
      ascendant: natalData.ascendant,
      mc: natalData.mc,
      houses: Object.entries(natalData.houses).map(([num, h]) => ({ number: parseInt(num), ...h })),
      aspects: natalData.aspects,
      dominant: natalData.dominant
    };

    if (user_id && supabase) {
      try {
        await saveNatalChart(user_id, natalData);
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', user_id).single();
        if (profile) {
          const identikit = buildIdentikitNatale(natalData, profile);
          await saveUserReportNatal(user_id, identikit);
        }
      } catch (dbErr) {
        console.error('DB error legacy natal-chart:', dbErr.message);
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Legacy natal chart error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ENDPOINT: GEOCODIFICA
// ============================================================

app.get('/api/geocode', async (req, res) => {
  try {
    const city = req.query.city;
    const country = req.query.country;
    if (!city) return res.status(400).json({ error: 'Missing city' });

    const query = encodeURIComponent(city + ',' + (country || ''));
    let lat = null, lon = null, display_name = null, source = null;

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

    let timezone = null;
    const countryUpper = (country || '').toUpperCase();
    const COUNTRY_TZ = {
      'IT': 'Europe/Rome', 'FR': 'Europe/Paris', 'ES': 'Europe/Madrid',
      'DE': 'Europe/Berlin', 'UK': 'Europe/London', 'GB': 'Europe/London',
      'US': 'America/New_York', 'CA': 'America/Toronto', 'AU': 'Australia/Sydney',
      'BR': 'America/Sao_Paulo', 'AR': 'America/Argentina/Buenos_Aires',
      'JP': 'Asia/Tokyo', 'IN': 'Asia/Kolkata', 'CN': 'Asia/Shanghai', 'RU': 'Europe/Moscow'
    };

    if (COUNTRY_TZ[countryUpper]) {
      timezone = COUNTRY_TZ[countryUpper];
    } else {
      const tzOffset = Math.round(lon / 15);
      timezone = `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`;
    }

    res.json({
      lat, lng: lon,
      display_name: display_name || `${city}, ${country || ''}`,
      timezone,
      tz_offset: getHistoricalOffset(timezone, new Date().toISOString().split('T')[0]),
      source
    });
  } catch (err) {
    console.error('Geocode fatal error:', err);
    res.status(500).json({ error: err.message || 'Internal geocoding error' });
  }
});

// ============================================================
// ENDPOINT: TRANSITI (mantenuto, aggiornato per schema attuale)
// ============================================================

app.post('/api/transits', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (!supabase) return res.status(500).json({ error: 'Database not available' });

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (pErr || !profile) {
      return res.status(404).json({ error: 'Profilo non trovato' });
    }

    if (!profile.birth_date) {
      return res.status(400).json({ error: 'Data di nascita mancante' });
    }

    const lat = Number(profile.birth_latitude);
    const lng = Number(profile.birth_longitude);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Coordinate mancanti. Completa prima il geocoding.' });
    }

    const [y, m, d] = profile.birth_date.split('-').map(Number);
    const birthTime = profile.birth_time || '12:00';
    const timeParts = birthTime.split(':');
    const hh = parseInt(timeParts[0]) || 12;
    const mm = parseInt(timeParts[1]) || 0;

    const tzOffset = getHistoricalOffset(profile.birth_timezone, profile.birth_date);
    const utHour = hh - tzOffset + (mm / 60);
    const natalJD = swisseph.swe_julday(y, m, d, utHour, swisseph.SE_GREG_CAL);

    // Calcolo natale
    const natal = {};
    const bodies = [
      { key: 'sun', id: swisseph.SE_SUN }, { key: 'moon', id: swisseph.SE_MOON },
      { key: 'mercury', id: swisseph.SE_MERCURY }, { key: 'venus', id: swisseph.SE_VENUS },
      { key: 'mars', id: swisseph.SE_MARS }, { key: 'jupiter', id: swisseph.SE_JUPITER },
      { key: 'saturn', id: swisseph.SE_SATURN }, { key: 'uranus', id: swisseph.SE_URANUS },
      { key: 'neptune', id: swisseph.SE_NEPTUNE }, { key: 'pluto', id: swisseph.SE_PLUTO }
    ];

    for (const b of bodies) {
      const res = calcPlanetSync(natalJD, b.id);
      if (res) natal[b.key] = res.longitude;
    }

    const houseResult = calcHousesSync(natalJD, lat, lng);
    if (houseResult) {
      natal.houses = houseResult.house;
      natal.ascendant = houseResult.ascendant;
      natal.mc = houseResult.mc;
    } else {
      return res.status(500).json({ error: 'Calcolo case fallito' });
    }

    const ASPECTS = [
      { name: 'congiunzione', angle: 0, orb: 3 },
      { name: 'opposizione', angle: 180, orb: 3 },
      { name: 'quadrato', angle: 90, orb: 3 },
      { name: 'trigono', angle: 120, orb: 3 },
      { name: 'sestile', angle: 60, orb: 3 }
    ];

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

    function calcSeverity(planet, targetPlanet, orb, aspectType) {
      const SLOW_PLANETS = ['saturn', 'uranus', 'neptune', 'pluto'];
      const MEDIUM_PLANETS = ['jupiter', 'mars'];
      const isSlow = SLOW_PLANETS.includes(planet);
      const isMedium = MEDIUM_PLANETS.includes(planet);
      const STRONG_ASPECTS = ['congiunzione', 'quadrato', 'opposizione'];
      const isStrongAspect = STRONG_ASPECTS.includes(aspectType);

      if (isSlow && orb <= 1.0 && isStrongAspect) return 'high';
      if (isSlow && orb <= 2.0) return 'high';
      if (isMedium && orb <= 1.0 && isStrongAspect) return 'high';
      if (orb <= 1.0) return 'medium';
      if (isSlow && orb <= 3.0) return 'medium';
      if (isMedium && orb <= 2.0) return 'medium';
      return 'low';
    }

    const today = new Date();
    const allEvents = [];
    const daily = [];

    for (let i = 0; i < 90; i++) {
      const cur = new Date(today);
      cur.setDate(today.getDate() + i);
      const jd = swisseph.swe_julday(cur.getFullYear(), cur.getMonth() + 1, cur.getDate(), 12, swisseph.SE_GREG_CAL);

      const trans = {};
      for (const b of bodies) {
        const res = calcPlanetSync(jd, b.id);
        if (res) trans[b.key] = res.longitude;
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
                event_date: ed, event_type: 'major_aspect',
                planet: tName, target_planet: nName, aspect_type: asp.name,
                orb_degrees: orbVal, title: `${tName} ${asp.name} ${nName} (Natale)`,
                description: `Il transito di ${tName} forma un ${asp.name} con ${nName} del tema natale. Orb: ${orbVal}°`,
                severity, exact_timestamp: nd.toISOString()
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
              event_date: ed, event_type: 'planet_enters_house',
              planet: tName, house: h, orb_degrees: orbVal,
              title: `${tName} entra in Casa ${h}`,
              description: `Il pianeta ${tName} entra nella Casa ${h} del tema natale.`,
              severity, exact_timestamp: nd.toISOString()
            });
          }
        }
      }

      // Cambi di segno
      if (i > 0) {
        const yest = new Date(cur); yest.setDate(yest.getDate() - 1);
        const jdY = swisseph.swe_julday(yest.getFullYear(), yest.getMonth() + 1, yest.getDate(), 12, swisseph.SE_GREG_CAL);
        for (const b of bodies) {
          const lonY = calcPlanetSync(jdY, b.id)?.longitude;
          const lonT = trans[b.key];
          if (lonY !== undefined && lonT !== undefined) {
            const ySign = Math.floor(lonY / 30);
            const tSign = Math.floor(lonT / 30);
            if (ySign !== tSign) {
              const ed = cur.toISOString().split('T')[0];
              const nd = new Date(ed); nd.setDate(nd.getDate() - 3);
              const newSign = toZodiac(lonT).name;
              const severity = ['saturn', 'uranus', 'neptune', 'pluto'].includes(b.key) ? 'high' : 'medium';
              allEvents.push({
                event_date: ed, event_type: 'ingress', planet: b.key,
                orb_degrees: 0, title: `${b.key} entra in ${newSign}`,
                description: `Il pianeta ${b.key} entra nel segno zodiacale ${newSign}.`,
                severity, exact_timestamp: nd.toISOString()
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

    // Ordina per rilevanza
    const PRIORITY = {
      pluto: 10, neptune: 9, uranus: 8, saturn: 7,
      jupiter: 6, mars: 5, sun: 4, venus: 3, mercury: 2, moon: 1
    };

    const highEvents = allEvents
      .filter(e => e.severity === 'high')
      .map(e => ({
        ...e,
        score: (PRIORITY[e.planet] || 0) +
          (e.aspect_type === 'opposizione' ? 5 : e.aspect_type === 'quadrato' ? 4 :
           e.aspect_type === 'congiunzione' ? 3 : e.event_type === 'planet_enters_house' ? 2 : 1)
      }))
      .sort((a, b) => b.score - a.score);

    const top3Events = highEvents.slice(0, 3);

    // Salva top 3 in upcoming_events per Telegram
    if (top3Events.length > 0 && supabase) {
      try {
        await supabase.from('upcoming_events').delete().eq('user_id', user_id);
        const upcoming = top3Events.map(e => ({
          user_id, event_date: e.event_date, event_type: e.event_type,
          notify_at: e.exact_timestamp, telegram_sent: false,
          title: e.title, description: e.description, severity: e.severity
        }));
        const { error: insErr } = await supabase.from('upcoming_events').insert(upcoming);
        if (insErr) console.error('Errore upcoming_events:', insErr.message);
      } catch (e) {
        console.error('DB error upcoming_events:', e.message);
      }
    }

    res.json({
      date: today.toISOString().split('T')[0],
      natal: {
        ascendant: Math.round(natal.ascendant * 100) / 100,
        ascendantSign: toZodiac(natal.ascendant).name,
        mc: Math.round(natal.mc * 100) / 100,
        mcSign: toZodiac(natal.mc).name
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

app.get('/api/transits', (req, res) => {
  res.json({ status: 'Transits API attivo', use: 'POST /api/transits con body { user_id }' });
});

// ============================================================
// ENDPOINT: DOSSIER AI (genera ai_summary per identikit_natale)
// ============================================================

app.post('/api/dossier/generate', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (!supabase) return res.status(500).json({ error: 'Database not available' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY mancante' });
    }

    // 1. Leggi tema natale
    const { data: natalChart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !natalChart) {
      return res.status(404).json({ error: 'Tema natale non trovato' });
    }

    // 2. Leggi profilo
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user_id)
      .single();
    const nome = profile?.full_name?.split(' ')[0] || 'amico';

    // 3. Prepara dati
    const planets = natalChart.planets || {};
    const houses = natalChart.houses || {};
    const points = natalChart.points || {};

    const planetDesc = Object.entries(planets).map(([key, p]) =>
      `${PLANET_NAMES[key] || key}: ${p.sign} ${p.degree}°${p.minutes || 0}' (Casa ${p.house})${p.retrograde ? ' [R]' : ''}`
    ).join('\n');

    const houseDesc = Object.entries(houses).map(([num, h]) =>
      `Casa ${num}: ${h.sign} ${h.degree || 0}°${h.minutes || 0}'`
    ).join('\n');

    const asc = points.ascendant || houses['1'];
    const mc = points.mc;
    const moon = planets.moon;

    // 4. Prompt
    const prompt = `Sei Luna, un'astrologa professionista con 30 anni di esperienza. Hai appena calcolato il tema natale di ${nome} e devi scrivere il suo dossier astrologico personale — un documento interno che userai come base di conoscenza per tutte le future conversazioni con lui/lei.

Tono: profondo, misterioso ma accogliente, mai giudicante. Parla come se conoscessi ${nome} da anni. Non usare gergo tecnico a meno che non sia necessario. Sii calda, umana, con un filo di ironia dolce quando appropriato.

DATI TEMA NATALE:
${planetDesc}

CASE:
${houseDesc}

Ascendente: ${asc?.sign || '?'} ${asc?.degree || 0}°${asc?.minutes || 0}'
MC: ${mc?.sign || '?'} ${mc?.degree || 0}°${mc?.minutes || 0}'
Luna: ${moon?.sign || '?'}

Genera un JSON con queste chiavi:
- essenza: stringa (2-3 frasi che catturano l'anima del tema natale)
- punti_forti: array di 4-6 stringhe
- punti_critici: array di 3-5 stringhe
- amore: stringa (tendenza affettiva)
- denaro: stringa (rapporto con il denaro)
- lavoro: stringa (vocazione professionale)
- carriera: stringa (ambizione e realizzazione)
- salute: stringa (aree fisiche da curare)
- amici: stringa (rapporto sociale)
- famiglia: stringa (dinamica familiare)
- viaggi: stringa (rapporto con gli spostamenti)
- partner: stringa (tipo di relazione ideale)
- transiti_sensibili: array di 4-6 stringhe (punti deboli astrologici da monitorare)
- tono_vocale: stringa (istruzioni per l'AI su come parlare a questa persona)

Ogni sezione deve essere narrativa, personale, citabile in conversazione. Lunghezza: 2-4 frasi per sezione testuale.`;

    // 5. Chiama OpenAI
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Sei Luna, astrologa professionista. Rispondi SOLO con un JSON valido, senza markdown, senza spiegazioni.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 2500
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error('OpenAI error:', errText);
      return res.status(500).json({ error: 'Errore OpenAI', details: errText });
    }

    const openaiData = await openaiRes.json();
    const rawContent = openaiData.choices?.[0]?.message?.content || '';

    let dossier;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      dossier = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch (e) {
      console.error('JSON parse error:', e.message, 'Raw:', rawContent.substring(0, 200));
      return res.status(500).json({ error: 'Risposta OpenAI non valida', raw: rawContent.substring(0, 500) });
    }

    // 6. Aggiorna user_reports con ai_summary
    const { data: report } = await supabase
      .from('user_reports')
      .select('report_data')
      .eq('user_id', user_id)
      .eq('report_type', 'natal')
      .single();

    if (report && report.report_data) {
      const updatedData = { ...report.report_data };
      if (updatedData.identikit_natale) {
        updatedData.identikit_natale.ai_summary = dossier;
      }

      const { error: updErr } = await supabase
        .from('user_reports')
        .update({ report_data: updatedData, updated_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('report_type', 'natal');

      if (updErr) {
        console.error('Errore aggiornamento dossier:', updErr.message);
        return res.status(500).json({ error: 'Errore salvataggio dossier' });
      }
    }

    res.json({ success: true, message: 'Dossier generato e salvato', dossier_keys: Object.keys(dossier) });

  } catch (err) {
    console.error('Dossier error:', err);
    res.status(500).json({ error: err.message || 'Errore generazione dossier' });
  }
});

// ============================================================
// ENDPOINT: HEALTH CHECK & TEST
// ============================================================

app.get('/', (req, res) => {
  res.json({ status: 'ok', engine: 'swiss-ephemeris', precision: 'professional', version: '1.1.0' });
});

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
    res.json({
      jd, sun_longitude: sunResult.longitude,
      ascendant: houseResult.ascendant, mc: houseResult.mc,
      house1: houseResult.house[0], swisseph_available: true
    });
  } catch (err) {
    console.error('Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AVVIO SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`🌙 Luna Astrologica API v1.1.0 running on port ${PORT}`);
  console.log(`🔮 Swiss Ephemeris: attivo`);
  console.log(`🗄️  Supabase: ${supabase ? 'connesso' : 'NON CONNESSO'}`);
  console.log(`🤖 OpenAI: ${process.env.OPENAI_API_KEY ? 'configurata' : 'NON CONFIGURATA'}`);
});
