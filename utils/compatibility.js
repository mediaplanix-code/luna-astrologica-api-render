const {
  toZodiac,
  calcPlanetSync,
  calcHousesSync,
  getHistoricalOffset,
  angleDiff,
  BODIES,
  ASPECTS
} = require('./astrology');
const swisseph = require('swisseph');

// Elementi per sinastria
const ELEMENTS = {
  'Ariete': 'fuoco', 'Toro': 'terra', 'Gemelli': 'aria', 'Cancro': 'acqua',
  'Leone': 'fuoco', 'Vergine': 'terra', 'Bilancia': 'aria', 'Scorpione': 'acqua',
  'Sagittario': 'fuoco', 'Capricorno': 'terra', 'Acquario': 'aria', 'Pesci': 'acqua'
};

const MODALITY = {
  'Ariete': 'cardinale', 'Toro': 'fisso', 'Gemelli': 'mutabile',
  'Cancro': 'cardinale', 'Leone': 'fisso', 'Vergine': 'mutabile',
  'Bilancia': 'cardinale', 'Scorpione': 'fisso', 'Sagittario': 'mutabile',
  'Capricorno': 'cardinale', 'Acquario': 'fisso', 'Pesci': 'mutabile'
};

// Pianeti chiave per la sinastria, in ordine di importanza
const SYNASTRY_PLANETS = [
  { key: 'sun', label: 'Sole', weight: 10 },
  { key: 'moon', label: 'Luna', weight: 10 },
  { key: 'venus', label: 'Venere', weight: 9 },
  { key: 'mars', label: 'Marte', weight: 9 },
  { key: 'mercury', label: 'Mercurio', weight: 7 },
  { key: 'jupiter', label: 'Giove', weight: 6 },
  { key: 'saturn', label: 'Saturno', weight: 7 },
  { key: 'uranus', label: 'Urano', weight: 4 },
  { key: 'neptune', label: 'Nettuno', weight: 4 },
  { key: 'pluto', label: 'Plutone', weight: 5 }
];

// Aspetti sinastria con orb più stretto per precisione
const SYNASTRY_ASPECTS = [
  { name: 'congiunzione', angle: 0, orb: 6, score: 8 },
  { name: 'opposizione', angle: 180, orb: 6, score: 6 },
  { name: 'quadrato', angle: 90, orb: 5, score: 4 },
  { name: 'trigono', angle: 120, orb: 6, score: 9 },
  { name: 'sestile', angle: 60, orb: 4, score: 7 }
];

function calculatePartnerChart(birthDate, birthTime, lat, lng, timezone) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const timeParts = (birthTime || '12:00').split(':');
  const hour = parseInt(timeParts[0]) || 12;
  const minute = parseInt(timeParts[1]) || 0;

  const tzOffset = getHistoricalOffset(timezone, birthDate);
  const utHour = hour - tzOffset + (minute / 60);
  const jd = swisseph.swe_julday(year, month, day, utHour, swisseph.SE_GREG_CAL);

  const planets = [];
  let moonLon = null;

  for (const b of BODIES) {
    const lon = calcPlanetSync(jd, b.id);
    if (lon !== null) {
      if (b.key === 'moon') moonLon = lon;
      planets.push({ key: b.key, lon });
    }
  }

  const houseResult = calcHousesSync(jd, lat, lng);
  if (!houseResult) return null;

  const houses = [];
  for (let i = 0; i < 12; i++) {
    houses.push(toZodiac(houseResult.house[i]));
  }

  return {
    planets: planets.map(p => {
      const z = toZodiac(p.lon);
      return { key: p.key, sign: z.name, degree: z.degree, minutes: z.minutes, lon: p.lon };
    }),
    moonSign: moonLon ? toZodiac(moonLon).name : null,
    ascendant: toZodiac(houseResult.ascendant),
    mc: toZodiac(houseResult.mc),
    houses: houses,
    ascendantLon: houseResult.ascendant,
    mcLon: houseResult.mc
  };
}

function analyzeSynastry(userChart, partnerChart) {
  const aspects = [];
  const userPlanets = userChart.planets || [];
  const partnerPlanets = partnerChart.planets || [];

  // Aspetti tra pianeti
  for (const up of userPlanets) {
    for (const pp of partnerPlanets) {
      for (const asp of SYNASTRY_ASPECTS) {
        const diff = angleDiff(up.lon, pp.lon);
        if (Math.abs(diff - asp.angle) <= asp.orb) {
          const orbVal = Number((Math.abs(diff - asp.angle)).toFixed(2));
          const weight = (SYNASTRY_PLANETS.find(p => p.key === up.key)?.weight || 5) +
                         (SYNASTRY_PLANETS.find(p => p.key === pp.key)?.weight || 5);
          const score = Math.round((asp.score * weight * (1 - orbVal / asp.orb)) / 10);

          aspects.push({
            userPlanet: up.key,
            partnerPlanet: pp.key,
            aspect: asp.name,
            orb: orbVal,
            userSign: up.sign,
            partnerSign: pp.sign,
            score: score,
            isPositive: ['congiunzione', 'trigono', 'sestile'].includes(asp.name)
          });
        }
      }
    }
  }

  // Aspetti con punti sensibili (Ascendente, MC)
  const sensitivePoints = [
    { key: 'ascendant', lon: userChart.ascendantLon, sign: userChart.ascendant?.name, label: 'Ascendente' },
    { key: 'mc', lon: userChart.mcLon, sign: userChart.mc?.name, label: 'MC' }
  ];

  for (const sp of sensitivePoints) {
    if (!sp.lon) continue;
    for (const pp of partnerPlanets) {
      for (const asp of SYNASTRY_ASPECTS) {
        const diff = angleDiff(sp.lon, pp.lon);
        if (Math.abs(diff - asp.angle) <= asp.orb) {
          const orbVal = Number((Math.abs(diff - asp.angle)).toFixed(2));
          const weight = SYNASTRY_PLANETS.find(p => p.key === pp.key)?.weight || 5;
          const score = Math.round((asp.score * weight * (1 - orbVal / asp.orb)) / 10);

          aspects.push({
            userPlanet: sp.key,
            partnerPlanet: pp.key,
            aspect: asp.name,
            orb: orbVal,
            userSign: sp.sign,
            partnerSign: pp.sign,
            score: score,
            isPositive: ['congiunzione', 'trigono', 'sestile'].includes(asp.name),
            isSensitive: true
          });
        }
      }
    }
  }

  return aspects.sort((a, b) => b.score - a.score);
}

function analyzeElements(userChart, partnerChart) {
  const userElements = { fuoco: 0, terra: 0, aria: 0, acqua: 0 };
  const partnerElements = { fuoco: 0, terra: 0, aria: 0, acqua: 0 };

  for (const p of userChart.planets || []) {
    const el = ELEMENTS[p.sign];
    if (el) userElements[el]++;
  }
  for (const p of partnerChart.planets || []) {
    const el = ELEMENTS[p.sign];
    if (el) partnerElements[el]++;
  }

  // Aggiungi peso ascendente
  if (ELEMENTS[userChart.ascendant?.name]) userElements[ELEMENTS[userChart.ascendant.name]] += 2;
  if (ELEMENTS[partnerChart.ascendant?.name]) partnerElements[ELEMENTS[partnerChart.ascendant.name]] += 2;

  const compatibility = {
    fuoco: { fuoco: 8, terra: 6, aria: 9, acqua: 4 },
    terra: { fuoco: 6, terra: 8, aria: 5, acqua: 9 },
    aria: { fuoco: 9, terra: 5, aria: 7, acqua: 6 },
    acqua: { fuoco: 4, terra: 9, aria: 6, acqua: 8 }
  };

  const userDominant = Object.entries(userElements).sort((a, b) => b[1] - a[1])[0][0];
  const partnerDominant = Object.entries(partnerElements).sort((a, b) => b[1] - a[1])[0][0];

  return {
    user: userElements,
    partner: partnerElements,
    userDominant,
    partnerDominant,
    elementScore: compatibility[userDominant][partnerDominant] || 5
  };
}

function analyzeModalities(userChart, partnerChart) {
  const userModalities = { cardinale: 0, fisso: 0, mutabile: 0 };
  const partnerModalities = { cardinale: 0, fisso: 0, mutabile: 0 };

  for (const p of userChart.planets || []) {
    const mod = MODALITY[p.sign];
    if (mod) userModalities[mod]++;
  }
  for (const p of partnerChart.planets || []) {
    const mod = MODALITY[p.sign];
    if (mod) partnerModalities[mod]++;
  }

  const userDom = Object.entries(userModalities).sort((a, b) => b[1] - a[1])[0][0];
  const partnerDom = Object.entries(partnerModalities).sort((a, b) => b[1] - a[1])[0][0];

  const modCompatibility = {
    cardinale: { cardinale: 6, fisso: 7, mutabile: 5 },
    fisso: { cardinale: 7, fisso: 5, mutabile: 6 },
    mutabile: { cardinale: 5, fisso: 6, mutabile: 5 }
  };

  return {
    user: userModalities,
    partner: partnerModalities,
    userDominant: userDom,
    partnerDominant: partnerDom,
    modalityScore: modCompatibility[userDom][partnerDom] || 5
  };
}

function calculateSectorScores(aspects, elementAnalysis, modalityAnalysis) {
  const sectors = {
    amore: 0,
    comunicazione: 0,
    passione: 0,
    stabilita: 0,
    crescita: 0
  };

  // Pesi per pianeti nei settori
  const SECTOR_WEIGHTS = {
    amore: { venus: 3, moon: 2, sun: 1, mars: 1 },
    comunicazione: { mercury: 3, sun: 1, moon: 1, venus: 1 },
    passione: { mars: 3, venus: 2, sun: 1, pluto: 1 },
    stabilita: { saturn: 2, jupiter: 1, sun: 1, moon: 1 },
    crescita: { jupiter: 2, sun: 1, uranus: 1, pluto: 1 }
  };

  for (const asp of aspects) {
    for (const [sector, weights] of Object.entries(SECTOR_WEIGHTS)) {
      const userWeight = weights[asp.userPlanet] || 0;
      const partnerWeight = weights[asp.partnerPlanet] || 0;
      const totalWeight = userWeight + partnerWeight;
      if (totalWeight > 0) {
        sectors[sector] += asp.score * totalWeight * (asp.isPositive ? 1 : -0.5);
      }
    }
  }

  // Normalizza e aggiungi bonus elementi/modalità
  const maxScore = Math.max(...Object.values(sectors), 1);
  for (const key of Object.keys(sectors)) {
    sectors[key] = Math.round((sectors[key] / maxScore) * 50 + 50);
    sectors[key] = Math.min(100, Math.max(0, sectors[key]));
  }

  // Bonus elementi
  sectors.amore += Math.round((elementAnalysis.elementScore - 5) * 3);
  sectors.comunicazione += Math.round((modalityAnalysis.modalityScore - 5) * 3);
  sectors.stabilita += Math.round((elementAnalysis.elementScore - 5) * 2);

  for (const key of Object.keys(sectors)) {
    sectors[key] = Math.min(100, Math.max(0, sectors[key]));
  }

  return sectors;
}

function generateAssonanze(aspects, elementAnalysis, modalityAnalysis) {
  const assonanze = [];

  // Aspetti positivi principali
  const positiveAspects = aspects.filter(a => a.isPositive && a.score > 5);
  for (const asp of positiveAspects.slice(0, 4)) {
    const planetNames = {
      sun: 'Sole', moon: 'Luna', mercury: 'Mercurio', venus: 'Venere',
      mars: 'Marte', jupiter: 'Giove', saturn: 'Saturno', uranus: 'Urano',
      neptune: 'Nettuno', pluto: 'Plutone', ascendant: 'Ascendente', mc: 'MC'
    };
    const uP = planetNames[asp.userPlanet] || asp.userPlanet;
    const pP = planetNames[asp.partnerPlanet] || asp.partnerPlanet;
    const aspectNames = {
      congiunzione: 'unione profonda', trigono: 'armonia naturale', sestile: 'opportunità reciproca'
    };
    assonanze.push(`${uP} e ${pP} in ${aspectNames[asp.aspect] || asp.aspect}: energia che fluisce con facilità.`);
  }

  // Elementi compatibili
  if (elementAnalysis.elementScore >= 7) {
    const elNames = { fuoco: 'fuoco', terra: 'terra', aria: 'aria', acqua: 'acqua' };
    assonanze.push(`La vostra energia dominante (${elNames[elementAnalysis.userDominant]} e ${elNames[elementAnalysis.partnerDominant]}) si nutre a vicenda.`);
  }

  // Modalità complementari
  if (modalityAnalysis.modalityScore >= 7) {
    assonanze.push(`Uno di voi inizia, l'altro completa: una danza naturale tra ${modalityAnalysis.userDominant} e ${modalityAnalysis.partnerDominant}.`);
  }

  return assonanze;
}

function generateDiversita(aspects, elementAnalysis, modalityAnalysis) {
  const diversita = [];

  // Aspetti difficili
  const difficultAspects = aspects.filter(a => !a.isPositive && a.score > 3);
  for (const asp of difficultAspects.slice(0, 3)) {
    const planetNames = {
      sun: 'Sole', moon: 'Luna', mercury: 'Mercurio', venus: 'Venere',
      mars: 'Marte', jupiter: 'Giove', saturn: 'Saturno', uranus: 'Urano',
      neptune: 'Nettuno', pluto: 'Plutone'
    };
    const uP = planetNames[asp.userPlanet] || asp.userPlanet;
    const pP = planetNames[asp.partnerPlanet] || asp.partnerPlanet;
    diversita.push(`${uP} e ${pP} in ${asp.aspect}: tensione che chiede consapevolezza, non conflitto.`);
  }

  // Elementi in contrasto
  if (elementAnalysis.elementScore <= 5) {
    const elDesc = {
      fuoco: 'ardente e impulsivo', terra: 'pratico e stabile',
      aria: 'mentale e sociale', acqua: 'emotivo e intuitivo'
    };
    diversita.push(`La differenza tra ${elDesc[elementAnalysis.userDominant]} e ${elDesc[elementAnalysis.partnerDominant]} può creare fraintendimenti se non celebrate.`);
  }

  // Modalità in contrasto
  if (modalityAnalysis.modalityScore <= 5) {
    const modDesc = {
      cardinale: 'chi vuole iniziare', fisso: 'chi vuole mantenere', mutabile: 'chi vuole adattarsi'
    };
    diversita.push(`Uno di voi è ${modDesc[modalityAnalysis.userDominant]}, l'altro ${modDesc[modalityAnalysis.partnerDominant]}: il ritmo della relazione va negoziato.`);
  }

  return diversita;
}

function generateSettoriText(sectors) {
  const texts = {
    amore: sectors.amore >= 80
      ? "Una connessione emotiva profonda e naturale. Vi sentite 'a casa' l'uno con l'altro."
      : sectors.amore >= 60
      ? "C'è affetto e cura reciproca, anche se a volte esprimete l'amore in modi diversi."
      : sectors.amore >= 40
      ? "L'amore c'è, ma richiede sforzo consapevole per essere compreso e ricevuto."
      : "Il cuore parla lingue diverse. Imparare il 'dialetto' emotivo dell'altro è la chiave.",

    comunicazione: sectors.comunicazione >= 80
      ? "Parlate la stessa lingua, anche senza parole. La comprensione è immediata."
      : sectors.comunicazione >= 60
      ? "La conversazione scorre, con qualche scoglio da superare con pazienza."
      : sectors.comunicazione >= 40
      ? "A volte vi sentite su frequenze diverse. Ascoltare diventa più importante che parlare."
      : "La comunicazione è il vostro campo di crescita. Ogni dialogo costruisce un ponte.",

    passione: sectors.passion >= 80
      ? "Attrazione magnetica e reciproca. La chimica è palpabile e duratura."
      : sectors.passion >= 60
      ? "C'è desiderio, anche se espresso in modi diversi. Scoprire cosa accende l'altro."
      : sectors.passion >= 40
      ? "La passione esiste ma va coltivata. La routine può essere nemica."
      : "L'intimità fisica richiede esplorazione e pazienza. Non forzare, scoprite insieme.",

    stabilita: sectors.stabilita >= 80
      ? "Fondamenta solide. Sapete che potete contare l'uno sull'altro, sempre."
      : sectors.stabilita >= 60
      ? "C'è impegno, con qualche oscillazione quando le priorità divergono."
      : sectors.stabilita >= 40
      ? "La sicurezza nella relazione va costruita giorno per giorno, con azioni concrete."
      : "La stabilità è il vostro terreno fertile. Ogni promessa mantenuta è un mattone.",

    crescita: sectors.crescita >= 80
      ? "Insieme crescite, vi spingete oltre i limiti. La relazione è un acceleratore di evoluzione."
      : sectors.crescita >= 60
      ? "C'è spazio per crescere insieme, con qualche resistenza al cambiamento."
      : sectors.crescita >= 40
      ? "La crescita personale e di coppia richiede intenzionalità. Non succede da sola."
      : "Siete maestri l'uno per l'altro, anche attraverso le sfide. Ogni lezione è un dono."
  };

  return texts;
}

function calculateCompatibility(userChart, partnerChart) {
  const aspects = analyzeSynastry(userChart, partnerChart);
  const elementAnalysis = analyzeElements(userChart, partnerChart);
  const modalityAnalysis = analyzeModalities(userChart, partnerChart);
  const sectors = calculateSectorScores(aspects, elementAnalysis, modalityAnalysis);
  const assonanze = generateAssonanze(aspects, elementAnalysis, modalityAnalysis);
  const diversita = generateDiversita(aspects, elementAnalysis, modalityAnalysis);
  const settoriText = generateSettoriText(sectors);

  // Score globale
  const sectorAvg = Object.values(sectors).reduce((a, b) => a + b, 0) / 5;
  const aspectBonus = aspects.filter(a => a.isPositive).reduce((s, a) => s + a.score, 0) / 20;
  const difficultyPenalty = aspects.filter(a => !a.isPositive).reduce((s, a) => s + a.score, 0) / 40;
  const compatibilityScore = Math.round(Math.min(100, Math.max(0, sectorAvg + aspectBonus - difficultyPenalty)));

  return {
    compatibility_score: compatibilityScore,
    love_score: sectors.amore,
    communication_score: sectors.comunicazione,
    passion_score: sectors.passion,
    stability_score: sectors.stabilita,
    growth_score: sectors.crescita,
    synastry_aspects: aspects.slice(0, 15),
    element_analysis: elementAnalysis,
    modality_analysis: modalityAnalysis,
    assonanze: assonanze,
    diversita: diversita,
    settori: settoriText,
    luna_advice: compatibilityScore >= 80
      ? "Un'anima gemella non è chi è identico a te, ma chi ti completa. Questa sinastria parla di una connessione profonda, nutrita da assonanze naturali e sfide che costruiscono."
      : compatibilityScore >= 60
      ? "C'è chimica, c'è potenziale. Le differenze non sono ostacoli, sono inviti a crescere. Luna vede qui una storia che può diventare grande, con consapevolezza."
      : compatibilityScore >= 40
      ? "Il destino vi ha messi sulla stessa strada, ma con bagagli diversi. Non è una condanna, è un'opportunità. Ogni relazione che richiede sforzo, se onorata, diventa insegnamento."
      : "I contrasti qui sono forti, ma non fatali. A volte l'anima sceglie esattamente ciò che la sfida, per imparare ciò che non sa. Se c'è amore, c'è strada."
  };
}

module.exports = {
  calculatePartnerChart,
  calculateCompatibility
};
