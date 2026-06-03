const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { generateDossier } = require('../services/dossier');

router.post('/', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    await generateDossier(user_id);

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

module.exports = router;
