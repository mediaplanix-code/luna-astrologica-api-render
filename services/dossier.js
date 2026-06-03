const supabase = require('../config/supabase');
const { safeFetchJson } = require('../utils/fetch');
const { buildLocalDossier } = require('../utils/dossier-local');

async function generateDossier(user_id) {
  try {
    if (!supabase) return;
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY mancante, dossier saltato');
      return;
    }

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

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user_id)
      .single();
    const nome = profile?.full_name?.split(' ')[0] || 'amico';

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

module.exports = { generateDossier };
