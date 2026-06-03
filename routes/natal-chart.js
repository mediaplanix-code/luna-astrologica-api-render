const express = require('express');
const router = express.Router();
const swisseph = require('swisseph');
const supabase = require('../config/supabase');
const {
  toZodiac,
  calcPlanetSync,
  calcHousesSync,
  getHistoricalOffset
} = require('../utils/astrology');
const { generateDossier } = require('../services/dossier');
const { saveUserReport } = require('../services/user-report');

router.post('/', async (req, res) => {
  try {
    const { birthDate, birthTime, lat, lng, timezone, user_id } = req.body;
    if (!birthDate || lat == null || lng == null) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const [year, month, day] = birthDate.split('-').map(Number);
    const timeParts = (birthTime || '12:00').split(':');
    const hour = parseInt(timeParts[0]) || 12;
    const minute = parseInt(timeParts[1]) || 0;

    const tzOffset = getHistoricalOffset(timezone, birthDate);
    console.log(`Natal chart: date=${birthDate}, time=${birthTime}, tz=${timezone}, offset=${tzOffset}`);

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
      { key: 'pluto', id: swisseph.SE_PLUTO }
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
        } else {
          console.log('Natal chart salvato per user:', user_id);
          generateDossier(user_id).catch(err => {
            console.error('Background dossier error:', err.message);
          });
          saveUserReport(user_id).catch(err => {
            console.error('Background user report error:', err.message);
          });
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

module.exports = router;
