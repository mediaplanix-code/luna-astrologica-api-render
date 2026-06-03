const express = require('express');
const router = express.Router();
const { safeFetchJson } = require('../utils/fetch');
const { getHistoricalOffset } = require('../utils/astrology');

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

router.get('/', async (req, res) => {
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

    let timezone = null;
    const countryUpper = (country || '').toUpperCase();
    if (COUNTRY_TZ[countryUpper]) {
      timezone = COUNTRY_TZ[countryUpper];
    } else {
      const tzOffset = Math.round(lon / 15);
      timezone = `Etc/GMT${tzOffset >= 0 ? '-' : '+'}${Math.abs(tzOffset)}`;
    }

    res.json({
      lat,
      lng: lon,
      display_name: display_name || `${city}, ${country || ''}`,
      timezone,
      tz_offset: getHistoricalOffset(timezone, new Date().toISOString().split('T')[0]),
      source
    });
  } catch (err) {
    console.error('Geocode fatal error:', err);
    res.status(500).json({ error: err.message || 'Internal geocoding error' });
  }
});

module.exports = router;
