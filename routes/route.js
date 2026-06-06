// ============================================================
// routes/telegram.js — Endpoint per Bot Telegram
// ============================================================

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const {
  sendTelegramMessage,
  sendDailyHoroscopes,
  sendUpcomingEvents,
  sendBirthdayWishes,
  handleTelegramWebhook
} = require('../services/telegram');

// ===== WEBHOOK — Riceve messaggi da Telegram =====
router.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    await handleTelegramWebhook(update);
    res.json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.json({ ok: true });
  }
});

// ===== CRON — Oroscopo giornaliero =====
router.post('/cron/daily-horoscope', async (req, res) => {
  const cronSecret = req.headers['x-cron-secret'];
  if (cronSecret && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await sendDailyHoroscopes();
    res.json({ success: true, message: 'Oroscopi inviati' });
  } catch (err) {
    console.error('Cron daily error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CRON — Eventi importanti =====
router.post('/cron/upcoming-events', async (req, res) => {
  const cronSecret = req.headers['x-cron-secret'];
  if (cronSecret && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await sendUpcomingEvents();
    res.json({ success: true, message: 'Eventi inviati' });
  } catch (err) {
    console.error('Cron events error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== CRON — Auguri compleanno =====
router.post('/cron/birthday-wishes', async (req, res) => {
  const cronSecret = req.headers['x-cron-secret'];
  if (cronSecret && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await sendBirthdayWishes();
    res.json({ success: true, message: 'Auguri inviati' });
  } catch (err) {
    console.error('Cron birthday error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== TEST — Invia messaggio a un chat ID =====
router.post('/test', async (req, res) => {
  const { chat_id, message } = req.body;
  if (!chat_id) {
    return res.status(400).json({ error: 'chat_id required' });
  }

  const text = message || '<b>🌙 Test Luna Astrologica</b>\n\nIl bot funziona correttamente!';
  const result = await sendTelegramMessage(chat_id, text);

  if (result.error) {
    return res.status(500).json({ error: result.error });
  }

  res.json({ success: true, messageId: result.messageId });
});

// ===== INFO =====
router.get('/', (req, res) => {
  res.json({
    status: 'Telegram API attivo',
    endpoints: {
      webhook: 'POST /api/telegram/webhook',
      cron_daily: 'POST /api/telegram/cron/daily-horoscope',
      cron_events: 'POST /api/telegram/cron/upcoming-events',
      cron_birthday: 'POST /api/telegram/cron/birthday-wishes',
      test: 'POST /api/telegram/test { chat_id, message? }'
    }
  });
});

module.exports = router;
