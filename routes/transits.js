const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { calculateTransitEvents } = require('../services/transits-calculator');
const { calculateAndSaveDailyTransits } = require('../services/daily-transits');
const { saveUserReport } = require('../services/user-report');
const { toZodiac } = require('../utils/astrology');

router.post('/', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

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

    if (!profile.birth_date) {
      return res.status(400).json({ error: 'Data di nascita mancante' });
    }

    const lat = Number(profile.birth_latitude);
    const lng = Number(profile.birth_longitude);
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Coordinate mancanti. Completa prima il geocoding.' });
    }

    const result = calculateTransitEvents(profile, 90);
    const { natal, allEvents, daily, highEvents, top3Events, today } = result;

    console.log(`Transiti: ${allEvents.length} eventi, ${highEvents.length} HIGH, top3: ${top3Events.length}`);

    // Salva future_events in natal_charts
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

      // Salva top 3 in upcoming_events
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
            severity: e.severity,
            planet: e.planet,
            target_planet: e.target_planet,
            aspect_type: e.aspect_type,
            orb_degrees: e.orb_degrees
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

      // Background: daily transits + user report
      calculateAndSaveDailyTransits(user_id).then(result => {
        if (!result.error) {
          saveUserReport(user_id).catch(err => {
            console.error('Background user report update error:', err.message);
          });
        }
      }).catch(err => {
        console.error('Background daily transits error:', err.message);
      });
    }

    res.json({
      date: today,
      natal: {
        ascendant: Math.round(natal.ascendant * 100) / 100,
        ascendantSign: toZodiac(natal.ascendant).name,
        mc: Math.round(natal.mc * 100) / 100,
        mcSign: toZodiac(natal.mc).name
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

router.get('/', (req, res) => {
  res.json({ status: 'Transits API attivo', use: 'POST /api/transits con body { user_id }' });
});

module.exports = router;
