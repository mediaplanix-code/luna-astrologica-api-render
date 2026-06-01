// ============================================================
// RENDER API — CRON JOB ENDPOINTS
// Aggiungi questo al tuo server.js (o index.js) su Render
// ============================================================

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Inizializza Supabase (usa SERVICE ROLE KEY per operazioni admin)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY  // Necessario per bypassare RLS
);

// ============================================================
// MIDDLEWARE: Verifica sicurezza cron
// ============================================================
function verifyCronSecret(req, res, next) {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ============================================================
// ENDPOINT 1: Genera transiti giornalieri per TUTTI gli utenti
// POST /api/cron/generate-transits
// Schedule: ogni giorno alle 06:00
// ============================================================
app.post('/api/cron/generate-transits', verifyCronSecret, async (req, res) => {
    const startTime = Date.now();

    try {
        // 1. Ottieni tutti gli utenti con profilo completo
        const { data: profiles, error: profilesErr } = await supabase
            .from('profiles')
            .select('id, email, full_name, birth_date, birth_time, birth_city, birth_country, birth_latitude, birth_longitude, birth_timezone, telegram_chat_id')
            .not('birth_date', 'is', null)
            .not('birth_latitude', 'is', null);

        if (profilesErr) throw profilesErr;

        const today = new Date().toISOString().split('T')[0];
        let transitsCreated = 0;
        let eventsCreated = 0;
        let notificationsScheduled = 0;

        // 2. Per ogni utente, genera transiti
        for (const profile of profiles) {
            try {
                // ─── GENERA TRANSITI (usa la tua logica astrologica) ───
                // In produzione, chiama qui il tuo motore astrologico (Swiss Ephemeris, Astronomy Engine, ecc.)
                // Per ora, generiamo una struttura realistica

                const transitData = {
                    date: today,
                    moon_sign: getMoonSign(today),
                    sun_sign: getSunSign(today),
                    major_transits: generateTransitsForUser(profile, today),
                    daily_theme: generateDailyTheme(profile, today),
                    power_hour: generatePowerHour(profile),
                    challenging_hour: generateChallengingHour(profile),
                    lucky_number: generateLuckyNumber(profile, today),
                    lucky_color: generateLuckyColor(profile, today),
                    affirmation: generateAffirmation(profile, today),
                    advice: generateAdvice(profile, today)
                };

                // Salva transito
                const { error: transitErr } = await supabase
                    .from('daily_transits')
                    .upsert({
                        user_id: profile.id,
                        transit_date: today,
                        transit_data: transitData
                    }, { onConflict: 'user_id,transit_date' });

                if (!transitErr) transitsCreated++;

                // ─── GENERA EVENTI IMPORTANTI ───
                const events = await generateEventsForUser(profile, today);
                for (const event of events) {
                    const { data: eventData, error: eventErr } = await supabase
                        .from('astrological_events')
                        .upsert({
                            user_id: profile.id,
                            title: event.title,
                            description: event.description,
                            event_date: event.date,
                            event_type: event.type,
                            severity: event.severity,
                            is_notified: false
                        }, { onConflict: 'user_id,title,event_date' })
                        .select('id')
                        .single();

                    if (!eventErr && eventData) {
                        eventsCreated++;

                        // Pianifica notifica Telegram se l'utente ha chat_id
                        if (profile.telegram_chat_id && event.notifyBefore) {
                            const notifyDate = new Date(event.date);
                            notifyDate.setDate(notifyDate.getDate() - event.notifyBefore);

                            await supabase
                                .from('telegram_notifications')
                                .insert({
                                    user_id: profile.id,
                                    event_id: eventData.id,
                                    message_text: `🔮 ${event.title}\n\n${event.description}\n\nData: ${event.date}`,
                                    message_preview: event.title,
                                    scheduled_for: notifyDate.toISOString(),
                                    status: 'pending'
                                });

                            notificationsScheduled++;
                        }
                    }
                }

            } catch (userErr) {
                console.error(`Errore per utente ${profile.id}:`, userErr);
                // Continua con il prossimo utente, non bloccare tutto
            }
        }

        const duration = Date.now() - startTime;

        res.json({
            success: true,
            date: today,
            users_processed: profiles.length,
            transits_created: transitsCreated,
            events_created: eventsCreated,
            notifications_scheduled: notificationsScheduled,
            duration_ms: duration
        });

    } catch (err) {
        console.error('Cron generate-transits error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ENDPOINT 2: Pulisci transiti vecchi
// POST /api/cron/cleanup-transits
// Schedule: ogni domenica alle 04:00
// ============================================================
app.post('/api/cron/cleanup-transits', verifyCronSecret, async (req, res) => {
    try {
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const { error, count } = await supabase
            .from('daily_transits')
            .delete()
            .lt('transit_date', ninetyDaysAgo.toISOString().split('T')[0]);

        if (error) throw error;

        res.json({
            success: true,
            deleted_transits: count || 0,
            older_than: ninetyDaysAgo.toISOString().split('T')[0]
        });

    } catch (err) {
        console.error('Cron cleanup-transits error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ENDPOINT 3: Genera transiti per singolo utente (on-demand)
// POST /api/cron/generate-transit/:userId
// ============================================================
app.post('/api/cron/generate-transit/:userId', verifyCronSecret, async (req, res) => {
    try {
        const { userId } = req.params;
        const today = new Date().toISOString().split('T')[0];

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (!profile) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }

        const transitData = {
            date: today,
            generated_for: profile.full_name,
            birth_data: {
                date: profile.birth_date,
                time: profile.birth_time,
                city: profile.birth_city
            },
            // Qui inserisci la tua logica astrologica reale
            daily_theme: 'Trasformazione personale',
            transits: [
                { planet: 'Luna', aspect: 'congiunzione natale', effect: 'Emozioni intense' },
                { planet: 'Marte', aspect: 'trigono natale', effect: 'Energia e azione' }
            ],
            advice: 'Oggi è un giorno ideale per iniziare nuovi progetti'
        };

        const { error } = await supabase
            .from('daily_transits')
            .upsert({
                user_id: userId,
                transit_date: today,
                transit_data: transitData
            }, { onConflict: 'user_id,transit_date' });

        if (error) throw error;

        res.json({ success: true, user_id: userId, transit: transitData });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ENDPOINT 4: Stato cron (health check)
// GET /api/cron/status
// ============================================================
app.get('/api/cron/status', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const { count: totalUsers } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        const { count: todayTransits } = await supabase
            .from('daily_transits')
            .select('*', { count: 'exact', head: true })
            .eq('transit_date', today);

        const { count: pendingEvents } = await supabase
            .from('astrological_events')
            .select('*', { count: 'exact', head: true })
            .eq('is_notified', false)
            .gte('event_date', today);

        res.json({
            status: 'ok',
            date: today,
            total_users: totalUsers,
            today_transits: todayTransits,
            pending_events: pendingEvents,
            cron_configured: !!process.env.CRON_SECRET
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// FUNZIONI AUSILIARIE (placeholder — sostituisci con la tua logica astrologica)
// ============================================================

function getMoonSign(date) {
    const signs = ['Ariete','Toro','Gemelli','Cancro','Leone','Vergine',
        'Bilancia','Scorpione','Sagittario','Capricorno','Acquario','Pesci'];
    return signs[new Date(date).getDate() % 12];
}

function getSunSign(date) {
    const month = new Date(date).getMonth() + 1;
    const signs = ['Capricorno','Acquario','Pesci','Ariete','Toro','Gemelli',
        'Cancro','Leone','Vergine','Bilancia','Scorpione','Sagittario'];
    return signs[month - 1];
}

function generateTransitsForUser(profile, date) {
    // SOSTITUISCI con la tua logica reale (Swiss Ephemeris, Astronomy Engine, ecc.)
    return [
        { planet: 'Luna', position: '15° Scorpione', house: 7, 
          aspect_to_natal: 'Trigono Venere natale', effect: 'Intensità emotiva' },
        { planet: 'Mercurio', position: '22° Gemelli', house: 12,
          aspect_to_natal: 'Sestile Mercurio natale', effect: 'Intuizioni profonde' }
    ];
}

function generateDailyTheme(profile, date) {
    const themes = [
        'Trasformazione e scoperta interiore',
        'Comunicazione e connessioni',
        'Azione e determinazione',
        'Cura e nutrimento',
        'Espressione creativa',
        'Analisi e perfezionamento',
        'Equilibrio e armonia',
        'Profondità e mistero',
        'Avventura e espansione',
        'Responsabilità e struttura',
        'Innovazione e originalità',
        'Compassione e spiritualità'
    ];
    return themes[new Date(date).getDate() % 12];
}

function generatePowerHour(profile) {
    const hours = ['06:00-08:00', '08:00-10:00', '10:00-12:00', '12:00-14:00',
        '14:00-16:00', '16:00-18:00', '18:00-20:00'];
    return hours[profile.full_name.length % hours.length];
}

function generateChallengingHour(profile) {
    return '09:00-11:00';
}

function generateLuckyNumber(profile, date) {
    return (new Date(date).getDate() + profile.full_name.length) % 99 + 1;
}

function generateLuckyColor(profile, date) {
    const colors = ['Rosso scuro', 'Blu navy', 'Verde smeraldo', 'Oro', 'Argento',
        'Viola', 'Arancione', 'Rosa', 'Turchese', 'Bianco', 'Nero', 'Giallo'];
    return colors[new Date(date).getDate() % 12];
}

function generateAffirmation(profile, date) {
    return 'Oggi abbraccio il cambiamento con coraggio e fiducia.';
}

function generateAdvice(profile, date) {
    return 'Dedica tempo alla riflessione personale. Le intuizioni di oggi saranno preziose.';
}

async function generateEventsForUser(profile, today) {
    const events = [];
    const todayDate = new Date(today);

    // Luna Nuova / Plenilunio (ogni ~15 giorni)
    if (todayDate.getDate() === 1 || todayDate.getDate() === 15) {
        const isNewMoon = todayDate.getDate() === 1;
        events.push({
            title: isNewMoon ? '🌑 Luna Nuova' : '🌕 Plenilunio',
            description: 'Un momento cruciale per le intenzioni e le relazioni.',
            date: new Date(todayDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            type: isNewMoon ? 'new_moon' : 'full_moon',
            severity: 'high',
            notifyBefore: 1
        });
    }

    // Saturno (mensile)
    if (todayDate.getDate() === 1) {
        events.push({
            title: '🪐 Saturno ti invita alla riflessione',
            description: 'Periodo di maturazione e responsabilità.',
            date: new Date(todayDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            type: 'major_aspect',
            severity: 'medium',
            notifyBefore: 2
        });
    }

    // Compleanno
    const birthDate = new Date(profile.birth_date);
    if (todayDate.getMonth() === birthDate.getMonth() && 
        todayDate.getDate() === birthDate.getDate()) {
        events.push({
            title: `🎂 Buon compleanno ${profile.full_name}!`,
            description: 'Il tuo nuovo anno solare inizia oggi! Rivoluzione solare attiva.',
            date: today,
            type: 'solar_return',
            severity: 'critical',
            notifyBefore: 0  // Notifica immediata
        });
    }

    return events;
}

// ============================================================
// VARIABILI D'AMBIENTE NECESSARIE SU RENDER
// ============================================================
/*
Aggiungi queste variabili nel dashboard di Render:

SUPABASE_URL=https://yyserqquzqoywtqrqvlk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG... (la service role key, NON l'anon key!)
CRON_SECRET=una_stringa_segreta_lunga_e_complessa_minimo_32_caratteri

ATTENZIONE: La SERVICE ROLE KEY bypassa RLS. Non condividerla mai!
*/

module.exports = { verifyCronSecret };
