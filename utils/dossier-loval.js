const { getMCCareer } = require('./astrology');

const ELEMENTS = {
  'Ariete': 'fuoco', 'Toro': 'terra', 'Gemelli': 'aria', 'Cancro': 'acqua',
  'Leone': 'fuoco', 'Vergine': 'terra', 'Bilancia': 'aria', 'Scorpione': 'acqua',
  'Sagittario': 'fuoco', 'Capricorno': 'terra', 'Acquario': 'aria', 'Pesci': 'acqua'
};

const ESSENCE = {
  fuoco: "Un'anima ardente, guidata dall'istinto e dalla passione. Porti in te una scintilla inestinguibile che contagia chi ti sta vicino.",
  terra: "Una natura solida e pragmatica. Costruisci con pazienza, radicato nei valori reali. La stabilità è il tuo superpotere.",
  aria: "Una mente agile e curiosa. Il mondo delle idee è il tuo territorio naturale. Vedi connessioni dove gli altri vedono solo frammenti.",
  acqua: "Un cuore profondo e intuitivo. Percepisci ciò che gli altri non vedono. La sensibilità è il tuo radar interiore."
};

function buildLocalDossier(natalChart) {
  try {
    const planets = natalChart.planets || [];
    const houses = natalChart.houses || [];
    const points = natalChart.points || {};

    const asc = points.ascendant || {};
    const mc = points.mc || {};
    const moonSign = points.moon_sign || '';

    const elementCount = { fuoco: 0, terra: 0, aria: 0, acqua: 0 };
    planets.forEach(p => {
      if (ELEMENTS[p.sign]) elementCount[ELEMENTS[p.sign]]++;
    });
    if (ELEMENTS[asc.name]) elementCount[ELEMENTS[asc.name]] += 2;
    if (ELEMENTS[moonSign]) elementCount[ELEMENTS[moonSign]]++;

    const dominantElement = Object.entries(elementCount).sort((a, b) => b[1] - a[1])[0][0];

    const punti_forti = [];
    const punti_critici = [];

    const sun = planets.find(p => p.key === 'sun');
    const moon = planets.find(p => p.key === 'moon');
    const mars = planets.find(p => p.key === 'mars');
    const venus = planets.find(p => p.key === 'venus');
    const jupiter = planets.find(p => p.key === 'jupiter');
    const mercury = planets.find(p => p.key === 'mercury');
    const saturn = planets.find(p => p.key === 'saturn');
    const pluto = planets.find(p => p.key === 'pluto');
    const neptune = planets.find(p => p.key === 'neptune');

    if (sun) punti_forti.push(`Identità radiosa in ${sun.sign}: sai chi sei e non ti perdi nelle convenzioni altrui.`);
    if (moon) punti_forti.push(`Intuizione lunare in ${moon.sign}: capisci gli altri prima che aprano bocca.`);
    if (mars) punti_forti.push(`Azione decisa in ${mars.sign}: quando vuoi qualcosa, vai a prenderla senza mezze misure.`);
    if (venus) punti_forti.push(`Armonia venusiana in ${venus.sign}: crei bellezza nelle relazioni e nell'ambiente che ti circonda.`);
    if (jupiter) punti_forti.push(`Fortuna gioviana in ${jupiter.sign}: la vita ti sorride quando segui la tua vocazione con ottimismo.`);
    if (mercury) punti_forti.push(`Mente mercuriale in ${mercury.sign}: comunici con intelligenza e adattabilità.`);
    if (asc.name) punti_forti.push(`Ascendente in ${asc.name}: la gente percepisce subito la tua presenza autentica.`);

    if (saturn) punti_critici.push(`Saturno in ${saturn.sign}: a volte ti pesi troppo con responsabilità e auto-critica.`);
    if (pluto) punti_critici.push(`Plutone in ${pluto.sign}: trasformazioni intense che richiedono resilienza e accettazione del cambiamento.`);
    if (neptune) punti_critici.push(`Nettuno in ${neptune.sign}: il confine tra realtà e sogno può essere sottile.`);
    if (dominantElement === 'fuoco') punti_critici.push("L'impulsività può bruciare ponti prima di costruirli. Respira prima di reagire.");
    if (dominantElement === 'acqua') punti_critici.push("L'eccessiva sensibilità può trasformarsi in vulnerabilità. Impara a filtrare.");
    if (dominantElement === 'aria') punti_critici.push("La distrazione intellettuale può allontanarti dal cuore delle cose.");
    if (dominantElement === 'terra') punti_critici.push("La rigidità pratica può soffocare la spontaneità. Lascia spazio all'imprevisto.");

    return {
      essenza: ESSENCE[dominantElement] || "Un'anima unica, in continua evoluzione. Ogni giorno scrivi una nuova pagina del tuo mito personale.",
      punti_forti: punti_forti.slice(0, 6),
      punti_critici: punti_critici.slice(0, 5),
      amore: moonSign ? `La tua Luna in ${moonSign} cerca connessioni emotive autentiche. Non ti accontenti di superficialità: vuoi sentire, non solo vedere.` : "Cerci profondità nelle relazioni. L'amore per te è un viaggio interiore, non una destinazione.",
      denaro: jupiter ? `Giove in ${jupiter.sign} indica opportunità di espansione materiale quando segui la tua vocazione. Il denaro arriva come conseguenza, non come obiettivo.` : "Gestisci le risorse con intuizione. Sai quando investire e quando conservare.",
      lavoro: mc.name ? `Il tuo MC in ${mc.name} suggerisce una carriera legata a ${getMCCareer(mc.name)}. Il successo arriva quando integri il tuo vero sé nel lavoro.` : "Il lavoro ideale ti permette di esprimere il tuo vero sé. Non accontentarti di ruoli che ti stringono.",
      carriera: mc.name ? `In ${mc.name} trovi la tua ambizione pubblica. La carriera è il palcoscenico dove il mondo vede il tuo valore.` : "La carriera è un campo di crescita personale, non solo di guadagno.",
      salute: mars ? `Marte in ${mars.sign}: l'energia fisica è il tuo termometro. Quando stai bene, ti muovi. Quando stai male, ti blocchi.` : "Ascolta il tuo corpo, è il tuo orologio biologico più preciso.",
      amici: `Selettivo ma leale. Dai poco, ma duri a lungo. La tua amicizia è un tesoro che pochi possiedono.`,
      famiglia: moonSign ? `La Luna in ${moonSign} ti lega al passato e alle radici. La famiglia è il tuo ancoraggio emotivo, per bene o per male.` : "La famiglia è il tuo ancoraggio emotivo. Onora le radici, anche se voli lontano.",
      viaggi: jupiter ? `Giove in ${jupiter.sign} ti spinge verso l'orizzonte. Ogni viaggio è un'espansione dell'anima.` : "I viaggi allargano la tua prospettiva. Cambiare aria cambia pensiero.",
      partner: venus ? `Venere in ${venus.sign}: cerchi bellezza, armonia e autenticità nel partner. Non ti accontenti di meno.` : "Cerci un'anima gemella, non solo un compagno. Qualcuno che veda oltre la superficie.",
      transiti_sensibili: [
        "Osserva i transiti di Saturno: sono lezioni, non punizioni. Costruiscono ciò che dura.",
        "Giove porta opportunità: non lasciare che la prudenza le blocchi. L'ottimismo è il tuo magnete.",
        "La Luna Nuova è il tuo reset mensile. Pianta semi di intenzione.",
        "I transiti di Urano richiedono flessibilità: resistere aumenta il dolore, cedere apre porte.",
        "Plutone trasforma lentamente ma definitivamente. Abbraccia la morte del vecchio per rinascere.",
        "Nettuno dissolve confini: la creatività fluisce, ma la confusione anche. Stai ancorato."
      ],
      tono_vocale: "Parla come un'amica saggia che conosce il cuore dell'utente da anni. Tono caldo, misterioso ma rassicurante. Usa metafore naturali (mare, montagne, stagioni). Non giudicare mai. Sii ironica solo quando dolce. Ricorda sempre il nome dell'utente e i dettagli del suo tema natale."
    };
  } catch (err) {
    console.error('buildLocalDossier error:', err.message);
    return {
      essenza: "Un'anima unica in continua evoluzione.",
      punti_forti: ["Intuizione", "Resilienza", "Autenticità"],
      punti_critici: ["A volte ti pesi troppo"],
      amore: "Cerci profondità nelle relazioni.",
      denaro: "Gestisci le risorse con prudenza.",
      lavoro: "Il lavoro ideale ti permette di esprimere il tuo vero sé.",
      carriera: "La carriera è un campo di crescita.",
      salute: "Ascolta il tuo corpo.",
      amici: "Selettivo ma leale.",
      famiglia: "Le radici sono importanti.",
      viaggi: "I viaggi allargano la prospettiva.",
      partner: "Cerci un'anima gemella.",
      transiti_sensibili: ["Saturno insegna, Giove espande."],
      tono_vocale: "Tono caldo e rassicurante."
    };
  }
}

module.exports = { buildLocalDossier };
