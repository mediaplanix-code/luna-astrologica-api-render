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

// ===== DST HISTORICAL OFFSETS (corretto per Italia 1916-1965) =====
function getHistoricalOffset(timezone, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const monthDay = month * 100 + day; // es. 707 per 7 luglio

  // Italy / Europe/Rome DST history
  if (timezone === 'Europe/Rome' || timezone === 'Europe/Paris') {
    if (year < 1916) return 0; // No DST

    // 1916-1965: DST attivo in Italia (con pause durante le guerre)
    // Semplificazione robusta: estate = +2, inverno = +1
    if (year >= 1916 && year <= 1965) {
      return (monthDay >= 325 && monthDay <= 926) ? 2 : 1;
    }

    // 1966-1970: DST last Sunday March -> last Sunday September
    if (year >= 1966 && year <= 1970) {
      return (monthDay >= 327 && monthDay <= 926) ? 2 : 1;
    }

    // 1971-1979: last Sunday March -> last Sunday September
    if (year >= 1971 && year <= 1979) {
      return (monthDay >= 325 && monthDay <= 924) ? 2 : 1;
    }

    // 1980+: last Sunday March -> last Sunday October
    return (monthDay >= 325 && monthDay <= 1026) ? 2 : 1;
  }

  if (timezone === 'Europe/London') {
    return (monthDay >= 325 && monthDay <= 1026) ? 1 : 0;
  }

  if (timezone === 'America/New_York') {
    return (monthDay >= 310 && monthDay <= 1103) ? -4 : -5;
  }

  // Fallback: parse Etc/GMT format
  if (timezone && timezone.startsWith('Etc/GMT')) {
    const match = timezone.match(/GMT([+-]?\d+)/);
    if (match) return parseInt(match[1]);
  }

  // Ultimate fallback
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

// ===== DOSSIER ASTROLOGICO (funzione interna) =====
async function generateDossier(user_id) {
  try {
    if (!supabase) return;
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY mancante, dossier saltato');
      return;
    }

    // 1. Leggi tema natale
    const { data: natalChart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !natalChart) {
      console.error('Dossier: tema natale non trovato');
      return;
    }

    if (natalChart.dossier_astrologico && Object.keys(natalChart.dossier_astrologico).length > 0) {
      console.log('Dossier già esistente per user:', user_id);
      return;
    }

    // 2. Leggi profilo
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user_id)
      .single();
    const nome = profile?.full_name?.split(' ')[0] || 'amico';

    // 3. Prepara dati
    const planets = natalChart.planets || [];
    const houses = natalChart.houses || [];
    const asc = natalChart.points?.ascendant || natalChart.ascendant;
    const mc = natalChart.points?.mc || natalChart.mc;
    const moonSign = natalChart.points?.moon_sign || natalChart.moonSign;

    const planetDesc = planets.map(p => 
      `${p.key}: ${p.sign} ${p.degree}°${p.minutes || 0}'`
    ).join('\n');

    const houseDesc = houses.map((h, i) => 
      `Casa ${i + 1}: ${h.name} ${h.degree || 0}°${h.minutes || 0}'`
    ).join('\n');

    // 4. Prompt Luna
    const prompt = `Sei Luna, un'astrologa professionista con 30 anni di esperienza. Hai appena calcolato il tema natale di ${nome} e devi scrivere il suo dossier astrologico personale — un documento interno che userai come base di conoscenza per tutte le future conversazioni con lui/lei.

Tono: profondo, misterioso ma accogliente, mai giudicante. Parla come se conoscessi ${nome} da anni. Non usare gergo tecnico a meno che non sia necessario. Sii calda, umana, con un filo di ironia dolce quando appropriato.

DATI TEMA NATALE:
${planetDesc}

CASE:
${houseDesc}

Ascendente: ${asc?.name || '?'} ${asc?.degree || 0}°${asc?.minutes || 0}'
MC: ${mc?.name || '?'} ${mc?.degree || 0}°${mc?.minutes || 0}'
Luna: ${moonSign || '?'}

Genera un JSON con queste chiavi:
- essenza: stringa (2-3 frasi)
- punti_forti: array di 4-6 stringhe
- punti_critici: array di 3-5 stringhe
- amore: stringa
- denaro: stringa
- lavoro: stringa
- carriera: stringa
- salute: stringa
- amici: stringa
- famiglia: stringa
- viaggi: stringa
- partner: stringa
- transiti_sensibili: array di 4-6 stringhe
- tono_vocale: stringa (istruzioni per l'AI)

Ogni sezione deve essere narrativa, personale, citabile in conversazione.`;

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
      console.error('OpenAI error:', await openaiRes.text());
      return;
    }

    const openaiData = await openaiRes.json();
    const rawContent = openaiData.choices?.[0]?.message?.content || '';

    let dossier;
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      dossier = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawContent);
    } catch (e) {
      console.error('JSON parse error:', e.message);
      return;
    }

    // 6. Salva
    const { error: saveErr } = await supabase
      .from('natal_charts')
      .update({
        dossier_astrologico: dossier,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user_id);

    if (saveErr) {
      console.error('Errore salvataggio dossier:', saveErr.message);
    } else {
      console.log(`✅ Dossier generato per user ${user_id}`);
    }
  } catch (err) {
    console.error('Dossier error:', err.message);
  }
}


// ===== DOSSIER LOCALE (rule-based, senza OpenAI) =====
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

function buildLocalDossier(natalChart) {
  try {
    const planets = natalChart.planets || [];
    const houses = natalChart.houses || [];
    const points = natalChart.points || {};

    const asc = points.ascendant || {};
    const mc = points.mc || {};
    const moonSign = points.moon_sign || '';

    // Mappa segni -> elementi
    const ELEMENTS = {
      'Ariete': 'fuoco', 'Toro': 'terra', 'Gemelli': 'aria', 'Cancro': 'acqua',
      'Leone': 'fuoco', 'Vergine': 'terra', 'Bilancia': 'aria', 'Scorpione': 'acqua',
      'Sagittario': 'fuoco', 'Capricorno': 'terra', 'Acquario': 'aria', 'Pesci': 'acqua'
    };

    // Conta elementi
    const elementCount = { fuoco: 0, terra: 0, aria: 0, acqua: 0 };
    planets.forEach(p => {
      if (ELEMENTS[p.sign]) elementCount[ELEMENTS[p.sign]]++;
    });
    if (ELEMENTS[asc.name]) elementCount[ELEMENTS[asc.name]] += 2;
    if (ELEMENTS[moonSign]) elementCount[ELEMENTS[moonSign]]++;

    const dominantElement = Object.entries(elementCount).sort((a, b) => b[1] - a[1])[0][0];

    const ESSENCE = {
      fuoco: "Un'anima ardente, guidata dall'istinto e dalla passione. Porti in te una scintilla inestinguibile che contagia chi ti sta vicino.",
      terra: "Una natura solida e pragmatica. Costruisci con pazienza, radicato nei valori reali. La stabilità è il tuo superpotere.",
      aria: "Una mente agile e curiosa. Il mondo delle idee è il tuo territorio naturale. Vedi connessioni dove gli altri vedono solo frammenti.",
      acqua: "Un cuore profondo e intuitivo. Percepisci ciò che gli altri non vedono. La sensibilità è il tuo radar interiore."
    };

    // Punti forti
    const punti_forti = [];
    const sun = planets.find(p => p.key === 'sun');
    const moon = planets.find(p => p.key === 'moon');
    const mars = planets.find(p => p.key === 'mars');
    const venus = planets.find(p => p.key === 'venus');
    const jupiter = planets.find(p => p.key === 'jupiter');
    const mercury = planets.find(p => p.key === 'mercury');

    if (sun) punti_forti.push(`Identità radiosa in ${sun.sign}: sai chi sei e non ti perdi nelle convenzioni altrui.`);
    if (moon) punti_forti.push(`Intuizione lunare in ${moon.sign}: capisci gli altri prima che aprano bocca.`);
    if (mars) punti_forti.push(`Azione decisa in ${mars.sign}: quando vuoi qualcosa, vai a prenderla senza mezze misure.`);
    if (venus) punti_forti.push(`Armonia venusiana in ${venus.sign}: crei bellezza nelle relazioni e nell'ambiente che ti circonda.`);
    if (jupiter) punti_forti.push(`Fortuna gioviana in ${jupiter.sign}: la vita ti sorride quando segui la tua vocazione con ottimismo.`);
    if (mercury) punti_forti.push(`Mente mercuriale in ${mercury.sign}: comunici con intelligenza e adattabilità.`);
    if (asc.name) punti_forti.push(`Ascendente in ${asc.name}: la gente percepisce subito la tua presenza autentica.`);

    // Punti critici
    const punti_critici = [];
    const saturn = planets.find(p => p.key === 'saturn');
    const pluto = planets.find(p => p.key === 'pluto');
    const neptune = planets.find(p => p.key === 'neptune');

    if (saturn) punti_critici.push(`Saturno in ${saturn.sign}: a volte ti pesi troppo con responsabilità e auto-critica.`);
    if (pluto) punti_critici.push(`Plutone in ${pluto.sign}: trasformazioni intense che richiedono resilienza e accettazione del cambiamento.`);
    if (neptune) punti_critici.push(`Nettuno in ${neptune.sign}: il confine tra realtà e sogno può essere sottile.`);
    if (dominantElement === 'fuoco') punti_critici.push("L'impulsività può bruciare ponti prima di costruirli. Respira prima di reagire.");
    if (dominantElement === 'acqua') punti_critici.push("L'eccessiva sensibilità può trasformarsi in vulnerabilità. Impara a filtrare.");
    if (dominantElement === 'aria') punti_critici.push("La distrazione intellettuale può allontanarti dal cuore delle cose.");
    if (dominantElement === 'terra') punti_critici.push("La rigidità pratica può soffocare la spontaneità. Lascia spazio all'imprevisto.");

    return {
      essenza: ESSENCE[dominantElement] || "Un'anima unica, in continua evoluzione. Ogni giorno scrivi una nuova pagina del tuo mito personale.",
      punti_forti: punti_forti.slice(0, 6),
      punti_critici: punti_critici.slice(0, 5),
      amore: moonSign ? `La tua Luna in ${moonSign} cerca connessioni emotive autentiche. Non ti accontenti di superficialità: vuoi sentire, non solo vedere.` : "Cerci profondità nelle relazioni. L'amore per te è un viaggio interiore, non una destinazione.",
      denaro: jupiter ? `Giove in ${jupiter.sign} indica opportunità di espansione materiale quando segui la tua vocazione. Il denaro arriva come conseguenza, non come obiettivo.` : "Gestisci le risorse con intuizione. Sai quando investire e quando conservare.",
      lavoro: mc.name ? `Il tuo MC in ${mc.name} suggerisce una carriera legata a ${getMCCareer(mc.name)}. Il successo arriva quando integri il tuo vero sé nel lavoro.` : "Il lavoro ideale ti permette di esprimere il tuo vero sé. Non accontentarti di ruoli che ti stringono.",
      carriera: mc.name ? `In ${mc.name} trovi la tua ambizione pubblica. La carriera è il palcoscenico dove il mondo vede il tuo valore.` : "La carriera è un campo di crescita personale, non solo di guadagno.",
      salute: mars ? `Marte in ${mars.sign}: l'energia fisica è il tuo termometro. Quando stai bene, ti muovi. Quando stai male, ti blocchi.` : "Ascolta il tuo corpo, è il tuo orologio biologico più preciso.",
      amici: `Selettivo ma leale. Dai poco, ma duri a lungo. La tua amicizia è un tesoro che pochi possiedono.`,
      famiglia: moonSign ? `La Luna in ${moonSign} ti lega al passato e alle radici. La famiglia è il tuo ancoraggio emotivo, per bene o per male.` : "La famiglia è il tuo ancoraggio emotivo. Onora le radici, anche se voli lontano.",
      viaggi: jupiter ? `Giove in ${jupiter.sign} ti spinge verso l'orizzonte. Ogni viaggio è un'espansione dell'anima.` : "I viaggi allargano la tua prospettiva. Cambiare aria cambia pensiero.",
      partner: venus ? `Venere in ${venus.sign}: cerchi bellezza, armonia e autenticità nel partner. Non ti accontenti di meno.` : "Cerci un'anima gemella, non solo un compagno. Qualcuno che veda oltre la superficie.",
      transiti_sensibili: [
        "Osserva i transiti di Saturno: sono lezioni, non punizioni. Costruiscono ciò che dura.",
        "Giove porta opportunità: non lasciare che la prudenza le blocchi. L'ottimismo è il tuo magnete.",
        "La Luna Nuova è il tuo reset mensile. Pianta semi di intenzione.",
        "I transiti di Urano richiedono flessibilità: resistere aumenta il dolore, cedere apre porte.",
        "Plutone trasforma lentamente ma definitivamente. Abbraccia la morte del vecchio per rinascere.",
        "Nettuno dissolve confini: la creatività fluisce, ma la confusione anche. Stai ancorato."
      ],
      tono_vocale: "Parla come un'amica saggia che conosce il cuore dell'utente da anni. Tono caldo, misterioso ma rassicurante. Usa metafore naturali (mare, montagne, stagioni). Non giudicare mai. Sii ironica solo quando dolce. Ricorda sempre il nome dell'utente e i dettagli del suo tema natale."
    };
  } catch (err) {
    console.error('buildLocalDossier error:', err.message);
    return {
      essenza: "Un'anima unica in continua evoluzione.",
      punti_forti: ["Intuizione", "Resilienza", "Autenticità"],
      punti_critici: ["A volte ti pesi troppo"],
      amore: "Cerci profondità nelle relazioni.",
      denaro: "Gestisci le risorse con prudenza.",
      lavoro: "Il lavoro ideale ti permette di esprimere il tuo vero sé.",
      carriera: "La carriera è un campo di crescita.",
      salute: "Ascolta il tuo corpo.",
      amici: "Selettivo ma leale.",
      famiglia: "Le radici sono importanti.",
      viaggi: "I viaggi allargano la prospettiva.",
      partner: "Cerci un'anima gemella.",
      transiti_sensibili: ["Saturno insegna, Giove espande."],
      tono_vocale: "Tono caldo e rassicurante."
    };
  }
}

// ===== USER REPORT (JSONB a 4 sezioni) =====
async function saveUserReport(user_id) {
  try {
    if (!supabase) {
      console.warn('UserReport: Supabase non disponibile');
      return;
    }

    // 1. Leggi tema natale
    const { data: natalChart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !natalChart) {
      console.error('UserReport: tema natale non trovato per user', user_id);
      return;
    }

    // 2. Genera dossier locale
    const dossier = buildLocalDossier(natalChart);

    // 3. Leggi upcoming_events
    const { data: upcoming, error: upErr } = await supabase
      .from('upcoming_events')
      .select('*')
      .eq('user_id', user_id)
      .order('event_date', { ascending: true })
      .limit(3);

    const top3Events = (upcoming || []).map(e => ({
      title: e.title,
      event_date: e.event_date,
      event_type: e.event_type,
      severity: e.severity,
      description: e.description,
      planet: e.planet,
      target_planet: e.target_planet,
      aspect_type: e.aspect_type
    }));

    // 4. Leggi daily_transits per oggi
    const today = new Date().toISOString().split('T')[0];
    const { data: daily, error: dailyErr } = await supabase
      .from('daily_transits')
      .select('*')
      .eq('user_id', user_id)
      .eq('transit_date', today)
      .single();

    // 5. Compone JSONB a 4 sezioni
    const reportData = {
      identikit_natale: {
        dossier: dossier,
        tema_natale: {
          planets: natalChart.planets,
          houses: natalChart.houses,
          points: natalChart.points,
          calculated_at: natalChart.calculated_at,
          house_system: natalChart.house_system,
          zodiac_type: natalChart.zodiac_type
        },
        generated_at: new Date().toISOString(),
        source: 'rule-based-v1',
        ai_generated: false
      },
      transiti_correnti: {
        oggi: daily ? {
          transit_date: daily.transit_date,
          transit_planets: daily.transit_planets,
          active_aspects: daily.active_aspects,
          activated_houses: daily.activated_houses,
          intensity_score: daily.intensity_score,
          daily_horoscope_text: daily.daily_horoscope_text,
          consiglio_pratico: daily.consiglio_pratico,
          interpretation_ai: daily.interpretation_ai
        } : {
          status: 'not_calculated',
          message: 'Calcola prima i transiti giornalieri via POST /api/daily-transits',
          hint: 'Dopo il calcolo transiti, chiama /api/daily-transits per popolare questa sezione'
        },
        generated_at: new Date().toISOString()
      },
      eventi_in_arrivo: {
        top_3: top3Events,
        count: top3Events.length,
        generated_at: new Date().toISOString()
      },
      profilo_emozionale: {
        status: 'pending',
        message: "Richiede almeno 5 sessioni di chat con Luna per essere generato dall'AI",
        sessions_needed: 5,
        sessions_current: 0,
        generated_at: new Date().toISOString()
      }
    };

    // 6. Upsert in user_reports
    const { error: upsertErr } = await supabase
      .from('user_reports')
      .upsert({
        user_id: user_id,
        report_type: 'dossier',
        title: 'Dossier Astrologico Personale',
        report_date: today,
        report_data: reportData,
        model_version: 'rule-based-v1',
        credits_used: 0,
        is_favorite: false
      }, { onConflict: 'user_id, report_type, report_date' });

    if (upsertErr) {
      console.error('UserReport: errore salvataggio:', upsertErr.message);
    } else {
      console.log(`✅ UserReport JSONB salvato per user ${user_id} — 4 sezioni popolate`);
    }
  } catch (err) {
    console.error('UserReport fatal error:', err.message);
  }
}

// ===== DAILY TRANSITS (popola daily_transits) =====
async function calculateAndSaveDailyTransits(user_id) {
  try {
    if (!supabase) {
      console.warn('DailyTransits: Supabase non disponibile');
      return { error: 'Database not available' };
    }

    // 1. Leggi profilo
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

    // 2. Parsing data e ora natale
    const [y, m, d] = profile.birth_date.split('-').map(Number);
    const birthTime = profile.birth_time || '12:00';
    const timeParts = birthTime.split(':');
    const hh = parseInt(timeParts[0]) || 12;
    const mm = parseInt(timeParts[1]) || 0;

    // 3. Timezone con DST storico
    const tzOffset = getHistoricalOffset(profile.birth_timezone, profile.birth_date);
    const utHour = hh - tzOffset + (mm / 60);
    const natalJD = swisseph.swe_julday(y, m, d, utHour, swisseph.SE_GREG_CAL);

    // 4. Calcolo tema natale
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
    if (!houseResult) {
      return { error: 'Calcolo case fallito' };
    }
    natal.houses = houseResult.house;
    natal.ascendant = houseResult.ascendant;
    natal.mc = houseResult.mc;

    // 5. Calcola transiti di OGGI
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const jdToday = swisseph.swe_julday(today.getFullYear(), today.getMonth() + 1, today.getDate(), 12, swisseph.SE_GREG_CAL);

    const trans = {};
    for (const b of bodies) {
      const lon = calcPlanetSync(jdToday, b.id);
      if (lon !== null) trans[b.key] = lon;
    }

    // 6. Aspetti attivi oggi vs natali
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

      // Case attivate
      if (!activatedHouses.includes(h)) {
        activatedHouses.push(h);
      }

      // Aspetti vs natali
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

    // 7. Genera testo oroscopo e consiglio
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

    // 8. Salva in daily_transits
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

    // Mappa paese -> timezone IANA
    let timezone = null;
    const countryUpper = (country || '').toUpperCase();
    const COUNTRY_TZ = {
      'IT': 'Europe/Rome',
      'FR': 'Europe/Paris',
      'ES': 'Europe/Madrid',
      'DE': 'Europe/Berlin',
      'UK': 'Europe/London',
      'GB': 'Europe/London',
      'US': 'America/New_York',
      'CA': 'America/Toronto',
      'AU': 'Australia/Sydney',
      'BR': 'America/Sao_Paulo',
      'AR': 'America/Argentina/Buenos_Aires',
      'JP': 'Asia/Tokyo',
      'IN': 'Asia/Kolkata',
      'CN': 'Asia/Shanghai',
      'RU': 'Europe/Moscow',
    };

    if (COUNTRY_TZ[countryUpper]) {
      timezone = COUNTRY_TZ[countryUpper];
    } else {
      const tzOffset = Math.round(lon / 15);
      timezone = `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`;
    }

    res.json({ lat, lng: lon, display_name: display_name || `${city}, ${country || ''}`, timezone, tz_offset: getHistoricalOffset(timezone, new Date().toISOString().split('T')[0]), source });
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

    // SALVA in natal_charts (upsert)
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
          // === NUOVO: genera dossier in background ===
          generateDossier(user_id).catch(err => {
            console.error('Background dossier error:', err.message);
          });
          // ============================================
          // === STEP 2: genera user report JSONB in background ===
          saveUserReport(user_id).catch(err => {
            console.error('Background user report error:', err.message);
          });
          // =====================================================
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
    const timeParts = birthTime.split(':');
    const hh = parseInt(timeParts[0]) || 12;
    const mm = parseInt(timeParts[1]) || 0;

    // 4. Timezone con DST storico
    const tzOffset = getHistoricalOffset(profile.birth_timezone, profile.birth_date);
    console.log(`Transits: date=${profile.birth_date}, time=${birthTime}, tz=${profile.birth_timezone}, offset=${tzOffset}`);

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

    // 9. Salva future_events in natal_charts
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
            event_type: e.event_type,
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

// ===== GENERATE DOSSIER (endpoint dedicato) =====
app.post('/api/generate-dossier', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    await generateDossier(user_id);

    // Verifica salvataggio
    const { data: chart, error } = await supabase
      .from('natal_charts')
      .select('dossier_astrologico')
      .eq('user_id', user_id)
      .single();

    if (error || !chart?.dossier_astrologico) {
      return res.status(500).json({ error: 'Dossier generation failed', details: error?.message });
    }

    res.json({ 
      success: true, 
      message: 'Dossier generato e salvato',
      preview: Object.keys(chart.dossier_astrologico)
    });
  } catch (err) {
    console.error('Generate-dossier endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== USER REPORT (endpoint dedicato) =====
app.post('/api/user-report', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    await saveUserReport(user_id);

    // Verifica
    const { data: report, error } = await supabase
      .from('user_reports')
      .select('report_data')
      .eq('user_id', user_id)
      .eq('report_type', 'dossier')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !report) {
      return res.status(500).json({ error: 'Report generation failed', details: error?.message });
    }

    res.json({
      success: true,
      message: 'Dossier completo generato e salvato in user_reports',
      sections: Object.keys(report.report_data || {}),
      preview: {
        identikit_natale: !!report.report_data?.identikit_natale?.dossier?.essenza,
        transiti_correnti: report.report_data?.transiti_correnti?.oggi?.status !== 'not_calculated',
        eventi_in_arrivo: (report.report_data?.eventi_in_arrivo?.top_3 || []).length,
        profilo_emozionale: report.report_data?.profilo_emozionale?.status
      }
    });
  } catch (err) {
    console.error('User-report endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== DAILY TRANSITS (endpoint dedicato) =====
app.post('/api/daily-transits', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const result = await calculateAndSaveDailyTransits(user_id);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'Transiti giornalieri calcolati e salvati',
      ...result
    });
  } catch (err) {
    console.error('Daily-transits endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Luna Astrologica API running on port ${PORT}`);
});
