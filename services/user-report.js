const supabase = require('../config/supabase');
const { buildLocalDossier } = require('../utils/dossier-local');

async function saveUserReport(user_id) {
  try {
    if (!supabase) {
      console.warn('UserReport: Supabase non disponibile');
      return;
    }

    const { data: natalChart, error: chartErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (chartErr || !natalChart) {
      console.error('UserReport: tema natale non trovato per user', user_id);
      return;
    }

    const dossier = buildLocalDossier(natalChart);

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

    const today = new Date().toISOString().split('T')[0];
    const { data: daily, error: dailyErr } = await supabase
      .from('daily_transits')
      .select('*')
      .eq('user_id', user_id)
      .eq('transit_date', today)
      .single();

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

    const { data: existing, error: findErr } = await supabase
      .from('user_reports')
      .select('id')
      .eq('user_id', user_id)
      .eq('report_type', 'natal_deep_dive')
      .eq('report_date', today)
      .limit(1)
      .single();

    let saveErr = null;
    if (existing && !findErr) {
      const { error: updErr } = await supabase
        .from('user_reports')
        .update({
          title: 'Dossier Astrologico Personale',
          report_data: reportData,
          model_version: 'rule-based-v1',
          credits_used: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      saveErr = updErr;
    } else {
      const { error: insErr } = await supabase
        .from('user_reports')
        .insert({
          user_id: user_id,
          report_type: 'natal_deep_dive',
          title: 'Dossier Astrologico Personale',
          report_date: today,
          report_data: reportData,
          model_version: 'rule-based-v1',
          credits_used: 0,
          is_favorite: false
        });
      saveErr = insErr;
    }

    if (saveErr) {
      console.error('UserReport: errore salvataggio:', saveErr.message);
    } else {
      console.log(`✅ UserReport JSONB salvato per user ${user_id} — 4 sezioni popolate`);
    }
  } catch (err) {
    console.error('UserReport fatal error:', err.message);
  }
}

module.exports = { saveUserReport };
