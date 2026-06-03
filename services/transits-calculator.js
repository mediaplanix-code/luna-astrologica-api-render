const swisseph = require('swisseph');
const {
  toZodiac,
  calcSeverity,
  calculateNatalChart,
  calculateTransitChart,
  angleDiff,
  getHouse,
  getHistoricalOffset,
  ASPECTS,
  PRIORITY
} = require('../utils/astrology');

function calculateTransitEvents(profile, days = 90) {
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
    throw new Error('Calcolo case fallito');
  }

  const today = new Date();
  const allEvents = [];
  const daily = [];

  for (let i = 0; i < days; i++) {
    const cur = new Date(today);
    cur.setDate(today.getDate() + i);
    const jd = swisseph.swe_julday(cur.getFullYear(), cur.getMonth() + 1, cur.getDate(), 12, swisseph.SE_GREG_CAL);

    const trans = calculateTransitChart(jd);

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
      const transYest = calculateTransitChart(jdY);

      for (const [tName, tDeg] of Object.entries(trans)) {
        const lonY = transYest[tName];
        if (lonY !== undefined) {
          const ySign = Math.floor(lonY / 30);
          const tSign = Math.floor(tDeg / 30);
          if (ySign !== tSign) {
            const ed = cur.toISOString().split('T')[0];
            const nd = new Date(ed); nd.setDate(nd.getDate() - 3);
            const newSign = toZodiac(tDeg).name;
            const severity = ['saturn', 'uranus', 'neptune', 'pluto'].includes(tName) ? 'high' : 'medium';

            allEvents.push({
              event_date: ed,
              event_type: 'ingress',
              planet: tName,
              orb_degrees: 0,
              title: `${tName} entra in ${newSign}`,
              description: `Il pianeta ${tName} entra nel segno zodiacale ${newSign}.`,
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
          planet: name,
          degree: Math.round(deg * 100) / 100,
          sign: toZodiac(deg).name,
          house: getHouse(deg, natal.houses),
          aspectsToNatal: aspects
        });
      }
    }
  }

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

  return {
    natal,
    allEvents,
    daily,
    highEvents,
    top3Events,
    today: today.toISOString().split('T')[0]
  };
}

module.exports = { calculateTransitEvents };
