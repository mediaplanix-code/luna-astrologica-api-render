// ============================================================
// RENDER SERVER -- Luna Astrologica API
// Swiss Ephemeris (swisseph npm) -- precisione professionale reale
// VERSIONE MODULARE: struttura pulita e manutenibile
// ============================================================

const express = require('express');
const cors = require('cors');
const swisseph = require('swisseph');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Routes
app.use('/api/geocode', require('./routes/geocode'));
app.use('/api/natal-chart', require('./routes/natal-chart'));
app.use('/api/transits', require('./routes/transits'));
app.use('/api/user-report', require('./routes/user-report'));
app.use('/api/daily-transits', require('./routes/daily-transits'));
app.use('/api/generate-dossier', require('./routes/generate-dossier'));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', engine: 'swiss-ephemeris', precision: 'professional', version: 'modular-v1' });
});

// Test ephemeris
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
    res.json({
      jd,
      sun_longitude: sunResult.longitude,
      ascendant: houseResult.ascendant,
      mc: houseResult.mc,
      house1: houseResult.house[0],
      swisseph_available: true
    });
  } catch (err) {
    console.error('Test error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Luna Astrologica API running on port ${PORT} [modular]`);
});
