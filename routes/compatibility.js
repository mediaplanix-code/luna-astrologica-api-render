const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { calculatePartnerChart, calculateCompatibility } = require('../utils/compatibility');

// POST /api/compatibility — calcolo affinità on-the-fly, GRATIS
router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      partner_name,
      partner_birthDate,
      partner_birthTime,
      partner_lat,
      partner_lng,
      partner_timezone
    } = req.body;

    // Validazione
    if (!user_id) {
      return res.status(400).json({ error: 'user_id required' });
    }
    if (!partner_birthDate || partner_lat == null || partner_lng == null) {
      return res.status(400).json({ error: 'Dati partner incompleti: birthDate, lat, lng obbligatori' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Database not available' });
    }

    // 1. Recupera tema natale dell'utente loggato
    const { data: userNatal, error: userErr } = await supabase
      .from('natal_charts')
      .select('*')
      .eq('user_id', user_id)
      .single();

    if (userErr || !userNatal) {
      console.error('Compatibility: tema natale utente non trovato');
      return res.status(404).json({ error: 'Tema natale utente non trovato. Calcola prima il tuo tema natale.' });
    }

    // 2. Calcola tema natale del partner al volo (senza salvare)
    const partnerChart = calculatePartnerChart(
      partner_birthDate,
      partner_birthTime || '12:00',
      Number(partner_lat),
      Number(partner_lng),
      partner_timezone || 'Europe/Rome'
    );

    if (!partnerChart) {
      return res.status(500).json({ error: 'Calcolo tema natale partner fallito' });
    }

    // 3. Analizza sinastria
    const result = calculateCompatibility(userNatal, partnerChart);

    // 4. Risposta completa
    res.json({
      success: true,
      partner_name: partner_name || 'Partner',
      user_natal_preview: {
        sun_sign: userNatal.planets?.find(p => p.key === 'sun')?.sign,
        moon_sign: userNatal.points?.moon_sign || userNatal.moonSign,
        ascendant: userNatal.points?.ascendant?.name || userNatal.ascendant?.name
      },
      partner_natal_preview: {
        sun_sign: partnerChart.planets.find(p => p.key === 'sun')?.sign,
        moon_sign: partnerChart.moonSign,
        ascendant: partnerChart.ascendant?.name
      },
      ...result,
      next_step: {
        message: "Vuoi l'interpretazione profonda di Luna? Apri la chat o la voce per un'esperienza astrologica completa.",
        action: "Inizia una conversazione con Luna",
        requires_credits: true
      }
    });

  } catch (err) {
    console.error('Compatibility fatal error:', err);
    res.status(500).json({ error: err.message || 'Errore nel calcolo affinità' });
  }
});

// GET /api/compatibility — info
router.get('/', (req, res) => {
  res.json({
    status: 'Compatibility API attivo',
    use: 'POST /api/compatibility con body { user_id, partner_birthDate, partner_lat, partner_lng }',
    note: 'Calcolo affinità gratuito e on-the-fly. Nessun dato salvato.',
    next_step: 'Per interpretazione approfondita, usa la chat con Luna (a consumo crediti)'
  });
});

module.exports = router;
