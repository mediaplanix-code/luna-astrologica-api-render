// ============================================
// LUNA ASTROLOGICA — server.js COMPLETO
// Step 1: Dossier + Eventi Speciali + Context Giornaliero
// Data: 2026-05-29
// ============================================
// ATTENZIONE: Questo file include STUB per Swiss Ephemeris
// così puoi testare SUBITO i nuovi endpoint (/generate-dossier, etc.)
// senza aspettare il merge con la tua logica C++ esistente.
// 
// Le righe da sostituire con la tua logica reale sono marcate con:
// [SOSTITUISCi CON LA TUA LOGICA SWISSEPH REALE]
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURAZIONE
// ============================================
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ ERRORE: SUPABASE_URL e SUPABASE_SERVICE_KEY sono obbligatori');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
// HELPER: Geocoding Multi-Provider
// (Nominatim → Open-Meteo)
// ============================================
async function geocodeLocation(city, country) {
  const query = encodeURIComponent(`${city}, ${country}`);

  // 1. Nominatim
  try {
    const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`, {
      headers: { 'User-Agent': 'LunaAstrologica/1.0 (contact@lunaastrologica.it)' }
    });
    const nomData = await nomRes.json();
    if (nomData && nomData.length > 0) {
      return {
        lat: parseFloat(nomData[0].lat),
        lon: parseFloat(nomData[0].lon),
        source: 'nominatim',
        timezone: null // da risolvere separatamente se serve
      };
    }
  } catch (e) {
    console.log('Nominatim fallito:', e.message);
  }

  // 2. Open-Meteo (più affidabile per production)
  try {
    const omRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=it&format=json`);
    const omData = await omRes.json();
    if (omData.results && omData.results.length > 0) {
      const r = omData.results[0];
      return {
        lat: r.latitude,
        lon: r.longitude,
        source: 'open-meteo',
        timezone: r.timezone
      };
    }
  } catch (e) {
    console.log('Open-Meteo fallito:', e.message);
  }

  throw new Error('Geocoding fallito per tutti i provider');
}

// ============================================
// HELPER: Julian Day (semplificato — SOLO PER TEST)
// [SOSTITUISCi CON LA TUA LOGICA SWISSEPH REALE: swisseph.swe_julday()]
// ============================================
function dateToJulianDay(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = (timeStr || '12:00').split(':').map(Number);
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  return jdn + (h - 12) / 24 + min / 1440;
}

// ============================================
// STUB SWISS EPHEMERIS
// [SOSTITUISCi CON LA TUA LOGICA SWISSEPH REALE]
// 
// Queste funzioni restituiscono dati strutturati compatibili
// con il tuo schema 'natal_charts' e 'upcoming_events'.
// Quando fai il merge, sostituisci solo il CONTENUTO di queste
// due funzioni con le tue chiamate a swisseph.
// ============================================

async function calculateNatalChart(julianDay, latitude, longitude) {
  // =========================================================
  // [INIZIO STUB — SOSTITUISCi CON swisseph.swe_calc_ut() etc.]
  // =========================================================
  console.log(`[STUB] Calcolo tema natale per JD=${julianDay}, lat=${latitude}, lon=${longitude}`);

  return {
    planets: {
      Sun: { longitude: 45.5, latitude: 0, distance: 1.0, sign: 'Toro', degree: 15.5, retrograde: false, house: 2, speed: 0.98 },
      Moon: { longitude: 112.3, latitude: -2.1, distance: 1.0, sign: 'Cancro', degree: 22.3, retrograde: false, house: 4, speed: 13.2 },
      Mercury: { longitude: 38.2, latitude: 0.5, distance: 0.85, sign: 'Toro', degree: 8.2, retrograde: false, house: 2, speed: 1.2 },
      Venus: { longitude: 78.9, latitude: 0.3, distance: 0.72, sign: 'Gemelli', degree: 18.9, retrograde: false, house: 3, speed: 1.1 },
      Mars: { longitude: 150.1, latitude: 0.1, distance: 1.52, sign: 'Leone', degree: 0.1, retrograde: false, house: 5, speed: 0.55 },
      Jupiter: { longitude: 95.4, latitude: 0.8, distance: 4.2, sign: 'Cancro', degree: 5.4, retrograde: false, house: 4, speed: 0.12 },
      Saturn: { longitude: 300.2, latitude: 0.0, distance: 9.5, sign: 'Acquario', degree: 0.2, retrograde: true, house: 10, speed: -0.03 },
      Uranus: { longitude: 45.8, latitude: 0.0, distance: 19.2, sign: 'Toro', degree: 15.8, retrograde: false, house: 2, speed: 0.04 },
      Neptune: { longitude: 350.1, latitude: 0.0, distance: 30.1, sign: 'Pesci', degree: 20.1, retrograde: false, house: 12, speed: 0.02 },
      Pluto: { longitude: 295.5, latitude: 0.0, distance: 39.5, sign: 'Capricorno', degree: 25.5, retrograde: true, house: 9, speed: -0.01 }
    },
    houses: {
      1: { cusp: 330.5, sign: 'Pesci', degree: 0.5 },
      2: { cusp: 30.2, sign: 'Toro', degree: 0.2 },
      3: { cusp: 60.8, sign: 'Gemelli', degree: 0.8 },
      4: { cusp: 90.1, sign: 'Cancro', degree: 0.1 },
      5: { cusp: 120.4, sign: 'Leone', degree: 0.4 },
      6: { cusp: 150.7, sign: 'Vergine', degree: 0.7 },
      7: { cusp: 150.5, sign: 'Vergine', degree: 0.5 },
      8: { cusp: 210.2, sign: 'Scorpione', degree: 0.2 },
      9: { cusp: 240.8, sign: 'Sagittario', degree: 0.8 },
      10: { cusp: 270.1, sign: 'Capricorno', degree: 0.1 },
      11: { cusp: 300.4, sign: 'Acquario', degree: 0.4 },
      12: { cusp: 330.7, sign: 'Pesci', degree: 0.7 }
    },
    aspects: [
      { planet1: 'Sun', planet2: 'Moon', type: 'sextile', orb: 1.2, nature: 'armonico' },
      { planet1: 'Sun', planet2: 'Saturn', type: 'trine', orb: 2.5, nature: 'armonico' },
      { planet1: 'Venus', planet2: 'Mars', type: 'square', orb: 0.8, nature: 'dinamico' },
      { planet1: 'Moon', planet2: 'Jupiter', type: 'conjunction', orb: 1.1, nature: 'armonico' },
      { planet1: 'Mercury', planet2: 'Uranus', type: 'conjunction', orb: 2.3, nature: 'dinamico' }
    ],
    points: {
      ascendant: 330.5,
      mc: 270.1,
      descendant: 150.5,
      ic: 90.1,
      northNode: 120.0,
      lilith: 210.0
    },
    house_system: 'Placidus',
    zodiac_type: 'Tropical',
    calculation_engine: 'Swiss Ephemeris'
  };
  // =========================================================
  // [FINE STUB]
  // =========================================================
}

async function calculateTransits(julianDayStart, natalChart, days = 90) {
  // =========================================================
  // [INIZIO STUB — SOSTITUISCi CON LA TUA LOGICA SWISSEPH REALE]
  // Deve restituire un array di eventi con questa struttura:
  // { date, planet, target, aspect, house, severity, orb }
  // =========================================================
  console.log(`[STUB] Calcolo transiti per ${days} giorni da JD=${julianDayStart}`);

  const events = [];
  const transitingPlanets = ['Saturno', 'Urano', 'Nettuno', 'Plutone', 'Giove', 'Marte'];
  const aspects = ['congiunzione', 'quadratura', 'opposizione', 'trigono', 'sesquiquadratura'];
  const targets = ['Sole natale', 'Luna natale', 'Ascendente', 'Venere natale', 'Marte natale', 'Mercurio natale'];
  const houses = [1, 2, 4, 7, 8, 10, 12];

  // Genera eventi fittizi distribuiti nei 90 giorni
  for (let i = 0; i < 10; i++) {
    const d = new Date();
    d.setDate(d.getDate() + Math.floor(Math.random() * days));
    events.push({
      date: d.toISOString().split('T')[0],
      planet: transitingPlanets[Math.floor(Math.random() * transitingPlanets.length)],
      target: targets[Math.floor(Math.random() * targets.length)],
      aspect: aspects[Math.floor(Math.random() * aspects.length)],
      house: houses[Math.floor(Math.random() * houses.length)],
      severity: 'HIGH',
      orb: parseFloat((Math.random() * 3).toFixed(1))
    });
  }

  return events.sort((a, b) => new Date(a.date) - new Date(b.date));
  // =========================================================
  // [FINE STUB]
  // =========================================================
}

// ============================================
// ENDPOINT ESISTENTI (Geocoding + Tema Natale + Transiti)
// ============================================

// --- Geocoding ---
app.post('/geocode', async (req, res) => {
  try {
    const { city, country } = req.body;
    if (!city) return res.status(400).json({ error: 'Città obbligatoria' });

    const result = await geocodeLocation(city, country || '');
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('/geocode error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Calcolo Tema Natale ---
app.post('/natal-chart', async (req, res) => {
  try {
    const { user_id, birth_date, birth_time, latitude, longitude } = req.body;
    if (!user_id || !birth_date || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Parametri mancanti: user_id, birth_date, latitude, longitude' });
    }

    const jd = dateToJulianDay(birth_date, birth_time);
    const chartData = await calculateNatalChart(jd, parseFloat(latitude), parseFloat(longitude));

    // Upsert in natal_charts
    const { error } = await supabase
      .from('natal_charts')
      .upsert({
        user_id,
        planets: chartData.planets,
        houses: chartData.houses,
        aspects: chartData.aspects,
        points: chartData.points,
        house_system: chartData.house_system,
        zodiac_type: chartData.zodiac_type,
        calculation_engine: chartData.calculation_engine,
        is_verified: true,
        calculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) throw error;

    res.json({ success: true, chart: chartData });
  } catch (err) {
    console.error('/natal-chart error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Transiti grezzi (90 giorni) ---
app.post('/transits', async (req, res) => {
  try {
    const { user_id, days = 90 } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio' });

    // Recupera tema natale
    const { data: chart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !chart) throw new Error('Tema natale non trovato. Calcolalo prima con /natal-chart');

    const todayJD = dateToJulianDay(new Date().toISOString().split('T')[0], '00:00');
    const events = await calculateTransits(todayJD, chart, days);

    res.json({ success: true, events_count: events.length, events });
  } catch (err) {
    console.error('/transits error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ============================================
// NUOVI ENDPOINT — STEP 1
// ============================================
// ============================================

// ============================================
// POST /generate-dossier
// Genera il dossier astrologico interpretato via GPT-4 (una sola volta per utente)
// ============================================
app.post('/generate-dossier', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio' });

    // 1. Recupera tema natale e profilo
    const { data: chart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !chart) throw new Error('Tema natale non trovato per questo utente');

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('full_name, birth_date, birth_time, birth_city, birth_country, sun_sign, moon_sign, rising_sign')
      .eq('id', user_id)
      .single();

    if (profErr) throw profErr;

    // 2. Se dossier già generato, restituisci cached
    if (chart.dossier_astrologico) {
      return res.json({ success: true, cached: true, dossier: chart.dossier_astrologico });
    }

    // 3. Prompt System per Luna (GPT-4)
    const systemPrompt = `Sei Luna, astrologa professionista italiana con 30 anni di esperienza. 
Hai un approccio empatico, caldo e mai giudicante. Usi metafore concrete e linguaggio accessibile.
Devi analizzare un tema natale e produrre un DOSSIER ASTROLOGICO interpretativo strutturato in JSON.
Il dossier deve essere CITABILE da un'AI in chat: ogni sezione è un "blocco" di conoscenza autonomo.
Tono professionale ma umano, come una consulenza dal vivo.`;

    // 4. Prompt User con dati grezzi
    const userPrompt = `Cliente: ${profile.full_name || 'Utente'}
Nato il: ${profile.birth_date || 'N/D'} alle ${profile.birth_time || 'N/D'} a ${profile.birth_city || 'N/D'}, ${profile.birth_country || 'N/D'}
Segno Solare: ${profile.sun_sign || 'N/D'}, Lunare: ${profile.moon_sign || 'N/D'}, Ascendente: ${profile.rising_sign || 'N/D'}

DATI TEMA NATALE (grezzi):
Pianeti: ${JSON.stringify(chart.planets, null, 2)}
Case: ${JSON.stringify(chart.houses, null, 2)}
Aspetti: ${JSON.stringify(chart.aspects, null, 2)}
Punti: ${JSON.stringify(chart.points, null, 2)}

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

    // 5. Chiama GPT-4
    console.log(`[DOSSIER] Generazione dossier per utente ${user_id}...`);
    const gptResponse = await callGPT4(systemPrompt, userPrompt, true);
    const dossier = JSON.parse(gptResponse);

    // 6. Salva in natal_charts
    const { error: updErr } = await supabase
      .from('natal_charts')
      .update({
        dossier_astrologico: dossier,
        interpretation_text: dossier.summary,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user_id);

    if (updErr) throw updErr;

    // 7. Marca profilo
    await supabase
      .from('profiles')
      .update({ dossier_generated_at: new Date().toISOString() })
      .eq('id', user_id);

    console.log(`[DOSSIER] Completato per utente ${user_id}`);
    res.json({ success: true, dossier });

  } catch (err) {
    console.error('/generate-dossier error:', err);
    res.status(500).json({ error: err.message, details: err.stack });
  }
});

// ============================================
// POST /calculate-transits
// Calcola 90gg transiti, genera interpretazioni batch GPT-4 per eventi HIGH,
// aggiorna le "3 caselle" nel profilo (next_events)
// ============================================
app.post('/calculate-transits', async (req, res) => {
  try {
    const { user_id, days = 90 } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio' });

    // 1. Recupera dati
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, full_name, sun_sign, moon_sign, rising_sign')
      .eq('id', user_id)
      .single();

    if (profErr || !profile) throw new Error('Profilo non trovato');

    const { data: chart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !chart) throw new Error('Tema natale non trovato');

    // 2. Calcolo transiti (stub o reale)
    const todayStr = new Date().toISOString().split('T')[0];
    const todayJD = dateToJulianDay(todayStr, '00:00');
    const rawEvents = await calculateTransits(todayJD, chart, days);

    // 3. Filtra solo HIGH e ordina
    const highEvents = rawEvents
      .filter(e => e.severity === 'HIGH')
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 12); // Max 12 eventi per batch GPT

    // 4. Se ci sono eventi HIGH, genera interpretazioni batch
    if (highEvents.length > 0) {
      const dossierSummary = chart.dossier_astrologico?.summary || 'Tema natale disponibile';

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

      // 5. Prepara eventi per upcoming_events
      const eventsToInsert = highEvents.map((evt, idx) => {
        const interp = gptData.interpretations?.[idx] || {};
        const eventDate = new Date(evt.date);
        const notifyAt = new Date(eventDate);
        notifyAt.setDate(notifyAt.getDate() - 5); // 5 giorni prima

        return {
          user_id,
          event_type: `${evt.planet} ${evt.aspect} ${evt.target}`,
          severity: 'HIGH',
          planet: evt.planet,
          target_planet: evt.target,
          house: evt.house,
          aspect_type: evt.aspect,
          event_date: evt.date,
          exact_timestamp: evt.date,
          orb_degrees: evt.orb,
          title: `${evt.planet} in ${evt.aspect} al ${evt.target}`,
          description: `${evt.planet} in ${evt.aspect} al ${evt.target} in Casa ${evt.house}`,
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

      // 6. Cancella vecchi upcoming_events per questo utente e inserisci nuovi
      const { error: delErr } = await supabase
        .from('upcoming_events')
        .delete()
        .eq('user_id', user_id);

      if (delErr) console.error('Errore cancellazione vecchi eventi:', delErr);

      const { error: insErr } = await supabase
        .from('upcoming_events')
        .insert(eventsToInsert);

      if (insErr) throw new Error(`Inserimento upcoming_events fallito: ${insErr.message}`);
    }

    // 7. Aggiorna le "3 caselle" nel profilo (next_events)
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
      title: e.title,
      description: e.description,
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

    // 8. Genera/Salva daily_transits per OGGI (template, no GPT-4)
    const today = new Date().toISOString().split('T')[0];
    const { data: existingDaily } = await supabase
      .from('daily_transits')
      .select('id')
      .eq('user_id', user_id)
      .eq('transit_date', today)
      .single();

    if (!existingDaily) {
      // Template oroscopo giornaliero (gratuito, istantaneo)
      const sunSign = profile.sun_sign || 'il tuo segno';
      const dailyHoroscope = `🌙 Oggi il cielo parla a ${profile.full_name || 'te'} con la voce dei transiti. ` +
        `Per chi ha il Sole in ${sunSign}, è un giorno di ascolto interiore. ` +
        `I pianeti in movimento suggeriscono attenzione alle dinamiche relazionali e alla chiarezza comunicativa. ` +
        `Non forzare i tempi: Luna ci ricorda che ogni seme ha il suo momento di germogliare.`;

      const { error: dailyErr } = await supabase
        .from('daily_transits')
        .insert({
          user_id,
          transit_date: today,
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
    console.error('/calculate-transits error:', err);
    res.status(500).json({ error: err.message, details: err.stack });
  }
});

// ============================================
// POST /get-daily-context
// Usato dal frontend ad ogni ingresso utente.
// Restituisse: daily_transits di oggi + next_events + crediti + dossier flag
// ============================================
app.post('/get-daily-context', async (req, res) => {
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

    // Se non esiste, prova a crearne uno base
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
    console.error('/get-daily-context error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /cron/daily
// Chiamato da cron-job.org ogni mattina (es. 8:00 CET)
// Invia oroscopo giornaliero + eventi speciali via Telegram
// ============================================
app.get('/cron/daily', async (req, res) => {
  try {
    if (!TELEGRAM_BOT_TOKEN) {
      return res.status(503).json({ error: 'Telegram non configurato (manca TELEGRAM_BOT_TOKEN)' });
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
      if (user.last_horoscope_sent === today) continue; // già inviato oggi

      // Recupera daily_transits di oggi
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
      } else {
        // Aggiungi firma e link se non presenti
        if (!horoscopeText.includes('luna-astrologica')) {
          horoscopeText += `\n\n🌙 La tua astrologa Luna ti aspetta in chat → https://luna-astrologica.pages.dev/chat`;
        }
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

        if (!tgRes.ok) {
          const tgErr = await tgRes.text();
          throw new Error(`Telegram API error: ${tgErr}`);
        }

        // Marca come inviato
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

      // Controlla limite 3/mese semplificato
      const lastNotif = evt.profiles?.last_event_notification;
      const currentMonth = today.substring(0, 7); // "2026-05"
      const lastMonth = lastNotif ? lastNotif.substring(0, 7) : null;
      // Nota: questo è un controllo base. Per un conteggio preciso serve una query dedicata.

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

        // Marca come inviato
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
    console.error('/cron/daily error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Luna Astrologica API',
    timestamp: new Date().toISOString(),
    openai_configured: !!OPENAI_API_KEY,
    telegram_configured: !!TELEGRAM_BOT_TOKEN
  });
});

// ============================================
// AVVIO SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`🌙 Luna Astrologica API running on port ${PORT}`);
  console.log(`📡 Supabase: ${SUPABASE_URL ? 'OK' : 'MANCANTE'}`);
  console.log(`🤖 OpenAI: ${OPENAI_API_KEY ? 'OK' : 'MANCANTE'}`);
  console.log(`✈️  Telegram: ${TELEGRAM_BOT_TOKEN ? 'OK' : 'NON CONFIGURATO'}`);
});
