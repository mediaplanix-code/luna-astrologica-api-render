const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { saveUserReport } = require('../services/user-report');

router.post('/', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    await saveUserReport(user_id);

    const { data: report, error } = await supabase
      .from('user_reports')
      .select('report_data')
      .eq('user_id', user_id)
      .eq('report_type', 'natal_deep_dive')
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

module.exports = router;
