// ============================================================
// services/telegram.js — Integrazione Bot Telegram
// Invia: oroscopo giornaliero, eventi, auguri compleanno
// Gancio al sito in ogni messaggio
// Nessuna interazione utente — solo push informativi
// ============================================================

const supabase = require('../config/supabase');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE_URL = process.env.SITE_URL || 'https://luna-astrologica.pages.dev';

// Mappa segni → emoji
const SIGN_EMOJI = {
  'Ariete': '♈', 'Toro': '♉', 'Gemelli': '♊', 'Cancro': '♋',
  'Leone': '♌', 'Vergine': '♍', 'Bilancia': '♎', 'Scorpione': '♏',
  'Sagittario': '♐', 'Capricorno': '♑', 'Acquario': '♒', 'Pesci': '♓'
};

// ===== INVIA MESSAGGIO TELEGRAM =====
async function sendTelegramMessage(chatId, text, options = {}) {
  if (!BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN mancante');
    return { error: 'Token mancante' };
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      ...options
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('Telegram API error:', data.description);
      return { error: data.description };
    }

    return { success: true, messageId: data.result.message_id };
  } catch (err) {
    console.error('Telegram send error:', err.message);
    return { error: err.message };
  }
}

// ===== GENERA OROSCOPO GIORNALIERO =====
function generateDailyHoroscope(sign, transits, userName) {
  const emoji = SIGN_EMOJI[sign] || '✨';
  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  let text = `<b>${emoji} Oroscopo di ${today}</b>\n\n`;
  
  if (userName) {
    text += `<b>Ciao ${userName}!</b> 🌙\n\n`;
  }

  // Testo base placeholder — in futuro generato da AI con transiti reali
  const horoscopes = {
    'Ariete': 'Oggi Marte ti dà energia. È il momento di agire sui progetti rimandati.',
    'Toro': 'Venere sorride alla tua stabilità. Un gesto dolce riscalderà la giornata.',
    'Gemelli': 'Mercurio favorisce la comunicazione. Parla, scrivi, connettiti.',
    'Cancro': 'La Luna ti avvolge. Ascolta le tue emozioni, sono la tua bussola.',
    'Leone': 'Il Sole illumina il tuo settore creativo. Brilla senza paura.',
    'Vergine': 'La precisione di oggi costruisce il successo di domani.',
    'Bilancia': 'L\'armonia è il tuo superpotere. Cerca equilibrio in ogni scelta.',
    'Scorpione': 'Profondità e intuizione ti guidano. Non temere di scavare.',
    'Sagittario': 'L\'orizzonte chiama. Un\'avventura ti aspetta dietro l\'angolo.',
    'Capricorno': 'La disciplina oggi è investimento per il futuro.',
    'Acquario': 'L\'innovazione è nel tuo DNA. Sfida le convenzioni.',
    'Pesci': 'La creatività scorre come un fiume. Lasciala fluire.'
  };

  text += horoscopes[sign] || 'Il cielo oggi ha un messaggio per te. Apri il cuore e ascolta.';

  if (transits && transits.length > 0) {
    text += `\n\n<b>🌟 Transiti di oggi:</b>\n`;
    transits.slice(0, 3).forEach(t => {
      text += `• ${t.planet} in ${t.sign} (Casa ${t.house})\n`;
    });
  }

  text += `\n\n<a href="${SITE_URL}"><b>🔮 Approfondisci sul sito →</b></a>`;

  return text;
}

// ===== GENERA EVENTI IMPORTANTI =====
function generateEventsMessage(events, sign, userName) {
  const emoji = SIGN_EMOJI[sign] || '✨';
  let text = `<b>${emoji} Eventi importanti in arrivo</b>\n\n`;

  if (userName) {
    text += `<b>Ciao ${userName}!</b> 🌙\n\n`;
  }

  events.forEach((e, i) => {
    const date = new Date(e.event_date).toLocaleDateString('it-IT', {
      day: 'numeric', month: 'long'
    });
    text += `<b>${i + 1}. ${e.title}</b>\n`;
    text += `📅 ${date}\n`;
    text += `${e.description}\n\n`;
  });

  text += `<a href="${SITE_URL}"><b>🔮 Approfondisci sul sito →</b></a>`;

  return text;
}

// ===== GENERA AUGURI COMPLEANNO =====
function generateBirthdayMessage(name, sign, age) {
  const emoji = SIGN_EMOJI[sign] || '🎂';
  let text = `<b>${emoji} Buon Compleanno, ${name}!</b> 🎉🌙\n\n`;
  text += `Oggi il Sole torna esattamente dove era quando sei nato. `;
  text += `È il tuo <b>ritorno solare</b> — un nuovo anno astrologico che inizia.\n\n`;
  text += `🎁 <b>Regalo di Luna:</b> 5 crediti bonus per il tuo nuovo anno!\n\n`;
  text += `<a href="${SITE_URL}"><b>🔮 Approfondisci sul sito →</b></a>`;

  return text;
}

// ===== INVIA OROSCOPO GIORNALIERO A TUTTI =====
async function sendDailyHoroscopes() {
  if (!supabase) {
    console.warn('Supabase non disponibile');
    return;
  }

  try {
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, full_name, sun_sign, telegram_chat_id, daily_horoscope_enabled')
      .not('telegram_chat_id', 'is', null)
      .eq('daily_horoscope_enabled', true);

    if (error) {
      console.error('Errore recupero utenti:', error.message);
      return;
    }

    console.log(`📨 Invio oroscopo a ${users?.length || 0} utenti Telegram`);

    for (const user of users || []) {
      if (!user.sun_sign || !user.telegram_chat_id) continue;

      const today = new Date().toISOString().split('T')[0];
      const { data: daily } = await supabase
        .from('daily_transits')
        .select('transit_planets')
        .eq('user_id', user.id)
        .eq('transit_date', today)
        .single();

      const text = generateDailyHoroscope(user.sun_sign, daily?.transit_planets, user.full_name);
      const result = await sendTelegramMessage(user.telegram_chat_id, text);

      if (result.success) {
        console.log(`✅ Oroscopo inviato a ${user.full_name || user.id}`);
      } else {
        console.error(`❌ Errore invio a ${user.id}:`, result.error);
      }
    }
  } catch (err) {
    console.error('Errore sendDailyHoroscopes:', err.message);
  }
}

// ===== INVIA EVENTI IMPORTANTI =====
async function sendUpcomingEvents() {
  if (!supabase) return;

  try {
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date();
    nextMonth.setDate(nextMonth.getDate() + 30);

    const { data: events, error } = await supabase
      .from('upcoming_events')
      .select('*')
      .gte('event_date', today)
      .lte('event_date', nextMonth.toISOString().split('T')[0])
      .eq('telegram_sent', false)
      .order('event_date', { ascending: true });

    if (error) {
      console.error('Errore recupero eventi:', error.message);
      return;
    }

    const byUser = {};
    for (const e of events || []) {
      if (!byUser[e.user_id]) byUser[e.user_id] = [];
      byUser[e.user_id].push(e);
    }

    for (const [userId, userEvents] of Object.entries(byUser)) {
      const topEvents = userEvents.slice(0, 3);

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, sun_sign, telegram_chat_id')
        .eq('id', userId)
        .single();

      if (!profile?.telegram_chat_id) continue;

      const text = generateEventsMessage(topEvents, profile.sun_sign, profile.full_name);
      const result = await sendTelegramMessage(profile.telegram_chat_id, text);

      if (result.success) {
        for (const e of topEvents) {
          await supabase
            .from('upcoming_events')
            .update({ telegram_sent: true })
            .eq('id', e.id);
        }
        console.log(`✅ Eventi inviati a ${userId}`);
      }
    }
  } catch (err) {
    console.error('Errore sendUpcomingEvents:', err.message);
  }
}

// ===== INVIA AUGURI COMPLEANNO =====
async function sendBirthdayWishes() {
  if (!supabase) return;

  try {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayPattern = `%-${month}-${day}`;

    const { data: birthdays, error } = await supabase
      .from('profiles')
      .select('id, full_name, birth_date, sun_sign, telegram_chat_id, credits')
      .not('telegram_chat_id', 'is', null)
      .ilike('birth_date', todayPattern);

    if (error) {
      console.error('Errore recupero compleanni:', error.message);
      return;
    }

    for (const user of birthdays || []) {
      const birthYear = parseInt(user.birth_date.split('-')[0]);
      const age = today.getFullYear() - birthYear;

      const text = generateBirthdayMessage(user.full_name, user.sun_sign, age);
      const result = await sendTelegramMessage(user.telegram_chat_id, text);

      if (result.success) {
        await supabase
          .from('profiles')
          .update({ credits: (user.credits || 0) + 5 })
          .eq('id', user.id);

        console.log(`🎂 Auguri inviati a ${user.full_name}`);
      }
    }
  } catch (err) {
    console.error('Errore sendBirthdayWishes:', err.message);
  }
}

// ===== WEBHOOK TELEGRAM — SOLO /start, NESSUNA ALTRA INTERAZIONE =====
async function handleTelegramWebhook(update) {
  if (!update.message) return;

  const chatId = update.message.chat.id;
  const text = update.message.text || '';

  console.log('Telegram message:', { chatId, text });

  // Solo /start — saluto iniziale + oroscopo immediato
  if (text.startsWith('/start')) {
    // Estrai user_id dal parametro /start USER_ID
    const parts = text.split(' ');
    const userId = parts[1] || null;

    let profile = null;

    if (userId) {
      // Recupera profilo dall'user_id passato nel link
      const { data: p, error } = await supabase
        .from('profiles')
        .select('id, full_name, sun_sign')
        .eq('id', userId)
        .single();

      if (!error && p) {
        profile = p;

        // Salva il telegram_chat_id nel profilo (prima volta)
        await supabase
          .from('profiles')
          .update({ telegram_chat_id: chatId })
          .eq('id', userId);
      }
    }

    // Fallback: cerca per chat_id già salvato
    if (!profile) {
      const { data: p } = await supabase
        .from('profiles')
        .select('id, full_name, sun_sign')
        .eq('telegram_chat_id', chatId)
        .single();
      profile = p;
    }

    const userName = profile?.full_name || '';
    const sign = profile?.sun_sign || '';
    const emoji = SIGN_EMOJI[sign] || '🌙';

    // === MESSAGGIO 1: BENVENUTO ===
    let welcome = `<b>${emoji} Benvenuto in Luna Astrologica!</b>\n\n`;
    if (userName) welcome += `<b>Ciao ${userName}!</b>\n`;
    welcome += `Sono Luna, la tua astrologa personale.\n`;
    welcome += `Da oggi riceverai il tuo oroscopo quotidiano e gli eventi speciali del cielo.`;

    await sendTelegramMessage(chatId, welcome);

    // === MESSAGGIO 2: OROSCOPO GIORNALIERO IMMEDIATO ===
    if (profile && sign) {
      const today = new Date().toISOString().split('T')[0];
      const { data: daily } = await supabase
        .from('daily_transits')
        .select('transit_planets')
        .eq('user_id', profile.id)
        .eq('transit_date', today)
        .single();

      const horoscopeText = generateDailyHoroscope(sign, daily?.transit_planets, userName);
      await sendTelegramMessage(chatId, horoscopeText);
    }

    return;
  }

  // Nessun altro comando — silenzio assoluto
  // L'utente non deve interagire, riceve solo push dal sistema
}

module.exports = {
  sendTelegramMessage,
  sendDailyHoroscopes,
  sendUpcomingEvents,
  sendBirthdayWishes,
  handleTelegramWebhook,
  generateDailyHoroscope,
  generateEventsMessage,
  generateBirthdayMessage
};
