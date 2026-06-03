const swisseph = require('swisseph');
const supabase = require('../config/supabase');
const {
  toZodiac,
  calcSeverity,
  calcPlanetSync,
  calcHousesSync,
  calculateNatalChart,
  calculateTransitChart,
  angleDiff,
  getHouse,
  getHistoricalOffset,
  ASPECTS
} = require('../utils/astrology');

async function calculateAndSaveDailyTransits(user_id) {
  try {
    if (!supabase) {
      console.warn('DailyTransits: Supabase non disponibile');
      return { error: 'Database not available' };
    }

    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (pErr || !profile) {
      console.error('DailyTransits: profilo non trovato');
      return { error: 'Profilo non trovato' };
    }

    if (!profile.birth_date || !profile.birth_latitude || !profile.birth_longitude) {
      return { error: 'Dati di nascita incompleti' };
    }

    const [y, m, d] = profile.birth_date.split('-').map(Number);
    const birthTime = profile.birth_time || '12:00';
    const timeParts = birthTime.split(':');
    const hh = parseInt(timeParts[0]) || 12;
    const mm = parseInt(timeParts[1]) || 0;

    const tzOffset = getHistoricalOffset(profile.birth_timezone, profile.birth_date);
    const utHour = hh - tzOffset + (mm / 60);
    const natalJD = swisseph.swe_julday(y, m, d, utHour, swisseph.SE_GREG_CAL);

    const natal = calculateNatalChart(natalJD, Number(profile.birth_latitude), Number(profile.birth_longitude));
    if (!natal.houses) {
      return { error: 'Calcolo case fallito' };
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const jdToday = swisseph.swe_julday(today.getFullYear(), today.getMonth() + 1, today.getDate(), 12, swisseph.SE_GREG_CAL);

    const trans = calculateTransitChart(jdToday);

    const activeAspects = [];
    const transitPlanets = [];
    const activatedHouses = [];
    let intensityScore = 0;

    for (const [name, deg] of Object.entries(trans)) {
      const z = toZodiac(deg);
      const h = getHouse(deg, natal.houses);

      transitPlanets.push({
        planet: name,
        degree: Math.round(deg * 100) / 100,
        sign: z.name,
        house: h,
        symbol: z.symbol
      });

      if (!activatedHouses.includes(h)) {
        activatedHouses.push(h);
      }

      for (const [nName, nDeg] of Object.entries(natal)) {
        if (['houses', 'ascendant', 'mc'].includes(nName)) continue;
        for (const asp of ASPECTS) {
          const diff = angleDiff(deg, nDeg);
          if (Math.abs(diff - asp.angle) <= asp.orb) {
            const orbVal = Number((Math.abs(diff - asp.angle)).toFixed(2));
            activeAspects.push({
              transitPlanet: name,
              natalPlanet: nName,
              aspect: asp.name,
              orb: orbVal,
              severity: calcSeverity(name, nName, orbVal, asp.name)
            });
            intensityScore++;
          }
        }
      }
    }

    const dominantTransits = activeAspects
      .filter(a => a.severity === 'high')
      .map(a => `${a.transitPlanet} ${a.aspect} ${a.natalPlanet} (orb ${a.orb}°)`);

    let dailyHoroscope = `Oggi ${todayStr} il cielo presenta ${activeAspects.length} aspetti attivi.`;
    if (dominantTransits.length > 0) {
      dailyHoroscope += ` Transiti principali: ${dominantTransits.join(', ')}.`;
    }
    if (activatedHouses.length > 0) {
      dailyHoroscope += ` Case attivate: ${activatedHouses.join(', ')}.`;
    }

    const consiglio = intensityScore > 5
      ? "Giornata intensa. Muoviti con consapevolezza, non lasciarti sopraffare dalle emozioni. Respira prima di ogni decisione importante."
      : intensityScore > 2
      ? "Giornata dinamica. Buon momento per iniziative e comunicazione. Ascolta la tua intuizione."
      : "Giornata tranquilla. Riposa, rifletti, pianifica. La quiete è fertile.";

    const { error: upsertErr } = await supabase
      .from('daily_transits')
      .upsert({
        user_id: user_id,
        transit_date: todayStr,
        transit_planets: transitPlanets,
        active_aspects: activeAspects,
        activated_houses: activatedHouses,
        intensity_score: intensityScore,
        daily_horoscope_text: dailyHoroscope,
        consiglio_pratico: consiglio,
        interpretation_ai: null
      }, { onConflict: 'user_id, transit_date' });

    if (upsertErr) {
      console.error('DailyTransits: errore salvataggio:', upsertErr.message);
      return { error: upsertErr.message };
    }

    console.log(`✅ DailyTransits salvato per user ${user_id} — ${activeAspects.length} aspetti, intensità ${intensityScore}`);
    return {
      success: true,
      transit_date: todayStr,
      active_aspects_count: activeAspects.length,
      intensity_score: intensityScore,
      activated_houses: activatedHouses
    };
  } catch (err) {
    console.error('DailyTransits fatal error:', err.message);
    return { error: err.message };
  }
}

module.exports = { calculateAndSaveDailyTransits };
