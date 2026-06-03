const express = require('express');
const router = express.Router();
const { calculateAndSaveDailyTransits } = require('../services/daily-transits');

router.post('/', async (req, res) => {
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

module.exports = router;
