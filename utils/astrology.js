const swisseph = require('swisseph');

const ZODIAC = [
  { name: 'Ariete', symbol: '♈' }, { name: 'Toro', symbol: '♉' },
  { name: 'Gemelli', symbol: '♊' }, { name: 'Cancro', symbol: '♋' },
  { name: 'Leone', symbol: '♌' }, { name: 'Vergine', symbol: '♍' },
  { name: 'Bilancia', symbol: '♎' }, { name: 'Scorpione', symbol: '♏' },
  { name: 'Sagittario', symbol: '♐' }, { name: 'Capricorno', symbol: '♑' },
  { name: 'Acquario', symbol: '♒' }, { name: 'Pesci', symbol: '♓' }
];

const ASPECTS = [
  { name: 'congiunzione', angle: 0, orb: 3 },
  { name: 'opposizione', angle: 180, orb: 3 },
  { name: 'quadrato', angle: 90, orb: 3 },
  { name: 'trigono', angle: 120, orb: 3 },
  { name: 'sestile', angle: 60, orb: 3 }
];

const PRIORITY = {
  pluto: 10, neptune: 9, uranus: 8, saturn: 7,
  jupiter: 6, mars: 5, sun: 4, venus: 3,
  mercury: 2, moon: 1
};

const BODIES = [
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

function toZodiac(deg) {
  const d = ((deg % 360) + 360) % 360;
  const idx = Math.floor(d / 30) % 12;
  return {
    ...ZODIAC[idx],
    degree: Math.floor(d % 30),
    minutes: Math.floor(((d % 30) % 1) * 60)
  };
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

function calculateNatalChart(jd, lat, lng) {
  const natal = {};
  for (const b of BODIES) {
    const lon = calcPlanetSync(jd, b.id);
    if (lon !== null) natal[b.key] = lon;
  }
  const houseResult = calcHousesSync(jd, lat, lng);
  if (houseResult) {
    natal.houses = houseResult.house;
    natal.ascendant = houseResult.ascendant;
    natal.mc = houseResult.mc;
  }
  return natal;
}

function calculateTransitChart(jd) {
  const trans = {};
  for (const b of BODIES) {
    const lon = calcPlanetSync(jd, b.id);
    if (lon !== null) trans[b.key] = lon;
  }
  return trans;
}

function angleDiff(a, b) {
  let diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function getHouse(deg, houses) {
  for (let i = 0; i < 12; i++) {
    let start = houses[i];
    let end = houses[(i + 1) % 12];
    let check = deg;
    if (start > end) {
      if (check < start) check += 360;
      end += 360;
    } else if (start > 270 && check < 90) {
      check += 360;
    }
    if (check >= start && check < end) return i + 1;
  }
  return 1;
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

function getMCCareer(sign) {
  const careers = {
    'Ariete': 'leadership, impresa, sport, coraggio',
    'Toro': 'arte, finanza, gastronomia, stabilità',
    'Gemelli': 'comunicazione, media, tecnologia, scrittura',
    'Cancro': 'cura, ospitalità, immobiliare, nutrimento',
    'Leone': 'spettacolo, creatività, insegnamento, leadership',
    'Vergine': 'salute, analisi, servizi, precisione',
    'Bilancia': 'relazioni, design, giustizia, diplomazia',
    'Scorpione': 'ricerca, psicologia, finanza, trasformazione',
    'Sagittario': 'viaggi, filosofia, editoria, avventura',
    'Capricorno': 'management, architettura, politica, struttura',
    'Acquario': 'innovazione, tecnologia, attivismo, comunità',
    'Pesci': 'arte, spiritualità, cura, empatia'
  };
  return careers[sign] || 'campi che valorizzano il tuo talento naturale';
}

module.exports = {
  ZODIAC,
  ASPECTS,
  PRIORITY,
  BODIES,
  toZodiac,
  calcSeverity,
  calcPlanetSync,
  calcHousesSync,
  calculateNatalChart,
  calculateTransitChart,
  angleDiff,
  getHouse,
  getHistoricalOffset,
  getMCCareer
};
