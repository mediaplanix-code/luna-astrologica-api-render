// ============================================================
// RENDER SERVER -- Luna Astrologica API
// Swiss Ephemeris (swisseph npm) -- precisione professionale reale
// MODIFICATO:
// - salva tema natale in natal_charts (upsert)
// - salva future_events (100 HIGH) in natal_charts.future_events JSONB
// - estrae top 3 in upcoming_events per Telegram
// - FIX: async sulla rotta natal-chart
// - FIX: geocoding robusto con fallback multipli
// ============================================================

const express = require('express');
const swisseph = require('swisseph');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

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

// ===== CALCOLO SEVERITY =====
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

// ===== WRAPPER SINCRONI swisseph =====
function calcPlanetSync(jd, planetId) {
  const result = swisseph.swe_calc_ut(jd, planetId, swisseph.SEFLG_SPEED);
  if (result.error) {
    console.warn('Calc error:', result.error);
    return null;
  }
  return result.longitude;
}

function calcHousesSync(jd, lat, lng) {
  const result = swisseph.swe_houses(jd, lat, lng, 'P');
  if (result.error) {
    console.error('Houses error:', result.error);
    return null;
  }
  return result;
}

// ===== GEOCODING ROBUSTO con fallback =====
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

    // --- Provider 1: Nominatim (OpenStreetMap) ---
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'LunaAstrologica/1.0' },
        timeout: 8000
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          lat = parseFloat(data[0].lat);
          lon = parseFloat(data[0].lon);
          display_name = data[0].display_name;
          source = 'nominatim';
        }
      }
    } catch (e) {
      console.warn('Nominatim failed:', e.message);
    }

    // --- Provider 2: BigDataCloud (free, no key needed for basic) ---
    if (lat === null) {
      try {
        const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=it`;
        // Nota: BigDataCloud non ha geocoding diretto per nome citta,
        // quindi usiamo un fallback diverso
      } catch (e) {
        console.warn('BigDataCloud skipped');
      }
    }

    // --- Provider 3: GeoDB Cities (free tier) ---
    if (lat === null) {
      try {
        const url = `https://wft-geo-db.p.rapidapi.com/v1/geo/cities?namePrefix=${encodeURIComponent(city)}&limit=1`;
        const response = await fetch(url, {
          headers: {
            'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || '',
            'X-RapidAPI-Host': 'wft-geo-db.p.rapidapi.com'
          },
          timeout: 8000
        });
        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            lat = data.data[0].latitude;
            lon = data.data[0].longitude;
            display_name = `${data.data[0].city}, ${data.data[0].country}`;
            source = 'geodb';
          }
        }
      } catch (e) {
        console.warn('GeoDB failed:', e.message);
      }
    }

    // --- Provider 4: Open-Meteo Geocoding (free, no key) ---
    if (lat === null) {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=it&format=json`;
        const response = await fetch(url, { timeout: 8000 });
        if (response.ok) {
          const data = await response.json();
          if (data.results && data.results.length > 0) {
            lat = data.results[0].latitude;
            lon = data.results[0].longitude;
            display_name = `${data.results[0].name}, ${data.results[0].country || country || ''}`;
            source = 'open-meteo';
          }
        }
      } catch (e) {
        console.warn('Open-Meteo failed:', e.message);
      }
    }

    // --- Se ancora null, errore ---
    if (lat === null || lon === null) {
      console.error('All geocoding providers failed for:', city, country);
      return res.status(404).json({ error: 'City not found', city, country });
    }

    // Calcolo timezone approssimativo basato su longitudine
    const tzOffset = Math.round(lon / 15);
    const timezone = `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`;

    console.log(`Geocode OK [${source}]: ${city} -> ${lat}, ${lon}, tz=${timezone}`);

    res.json({
      lat,
      lng: lon,
      display_name: display_name || `${city}, ${country || ''}`,
      timezone,
      tz_offset: tzOffset,
      source
    });

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

    console.log('Natal chart request:', { year, month, day, utHour, jd, lat, lng });

    const FLAG = swisseph.SEFLG_SPEED;
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

    console.log('Houses result:', houseResult);

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

    // SALVA in natal_charts (upsert)
    if (user_id) {
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
          console.error('Errore salvataggio natal_charts:', upsertErr);
        } else {
          console.log('Tema natale salvato in natal_charts per user:', user_id);
        }
      } catch (dbErr) {
        console.error('DB error natal_charts:', dbErr);
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

    res.json({
      jd,
      sun_longitude: sunResult.longitude,
      ascendant: houseResult.ascendant,
      mc: houseResult.mc,
      house1: houseResult.house[0],
      swisseph_available: true
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

    // Tema natale -- SINCRONO
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

    const houseResult = calcHousesSync(natalJD, Number(profile.birth_latitude), Number(profile.birth_longitude));
    if (houseResult) {
      natal.houses = houseResult.house;
      natal.ascendant = houseResult.ascendant;
      natal.mc = houseResult.mc;
    }

    console.log('Natal calcolato:', Object.keys(natal));

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

    // Calcola transiti 90 giorni -- SINCRONO
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

    // ORDINA per rilevanza e prendi top 3
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

    console.log(`Eventi totali: ${allEvents.length}, HIGH: ${highEvents.length}, Top 3: ${top3Events.length}`);

    // SALVA future_events (tutti HIGH) in natal_charts
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
        console.error('Errore salvataggio future_events:', updateErr);
      } else {
        console.log(`Salvati ${futureEvents.length} future_events in natal_charts`);
      }
    } catch (e) {
      console.error('DB error future_events:', e);
    }

    // SALVA top 3 in upcoming_events per Telegram
    if (top3Events.length > 0) {
      try {
        // Cancella vecchi upcoming_events
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
          console.error('Errore upcoming_events:', insErr);
        } else {
          console.log(`Salvati ${upcoming.length} upcoming_events per Telegram`);
        }
      } catch (e) {
        console.error('DB error upcoming_events:', e);
      }
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
      eventsFound: allEvents.length,
      highEventsFound: highEvents.length,
      top3ForTelegram: top3Events.length,
      message: 'Transiti calcolati e salvati'
    });

  } catch (err) {
    console.error('Transits error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET di test per verificare che l'endpoint e vivo
app.get('/api/transits', (req, res) => {
  res.json({ status: 'Transits API attivo', use: 'POST /api/transits con body { user_id }' });
});

app.listen(PORT, () => {
  console.log(`Luna Astrologica API running on port ${PORT}`);
});
