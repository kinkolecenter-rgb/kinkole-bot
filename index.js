const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const https = require('https');
const http = require('http');
const QRCode = require('qrcode');

// ============ CONFIGURATION ============
const CONFIG = {
  MON_NUMERO: process.env.MON_NUMERO || '243904246049',
  APPS_SCRIPT_URL: process.env.APPS_SCRIPT_URL || '',
  PORT: process.env.PORT || 3000,
};

// ============ ÉTAT BOT ============
let botState = {};
let sock = null;

function getState() {
  return botState;
}
function setState(s) {
  botState = s;
}
function resetState() {
  botState = {};
}

// ============ MODÈLES ============
function getModeleMatin(d) {
  return `Bonjour Team
* Ouverture du ${d.date} shop ${d.site} par ${d.manager} ${d.heure_ouv}
* Ouverture premier agent à ${d.premier_agent}
* Ouverture teller à ${d.teller}
* Premier ticket joué et payé
     ------------------------------------
* ${d.nom_premier_paye} : ${d.heure_premier_paye}
* Premier ticket payé par ${d.caissier_paye} ${d.heure_premier_paye}
* Nombre de caissière ${d.nb_caissiers}
* Equipe matin caisse :
     -------------------------------
${d.equipe_caisse}
* PR : ${d.pr}
     ---------
${d.pr_equipe}
* Center ${d.center}

      Etat Matériel
       ---------------------
* bureau ${d.bureau}
* Couloir caisse ${d.couloir}
* Charing room ${d.charging_room}
* Salle ${d.salle}
* Connexion ${d.connexion}
* Onduleur ${d.onduleur}
* Flybox ${d.flybox}
* Caisse ${d.caisse}
* Page : ${d.page}
* ram : ${d.ram}
* plus bico : ${d.bico}
* Sous Big gén ${d.big_gen}`;
}

function getModeleSoir(d) {
  return `Bonsoir Team
* Fermeture du ${d.date} shop ${d.site}
* Heure fermeture : ${d.heure_ferm}
* Dernier ticket : ${d.dernier_ticket}
* Collecte : ${d.collecte}
* Coffre : ${d.coffre}
* Rapport caisse : ${d.rapport_caisse}
* Etat fin journée : ${d.etat_fin}
* Superviseur : ${d.superviseur}`;
}

function getModeleSCheck(d) {
  return `Coffre ok hormis\n* collect ${d.collect}`;
}

function getModeleRateFixture(d) {
  return `Fixtures sport betting kinkole shop
Nb. Pages: ${d.nb_pages}
Nb.Copies par agent: ${d.nb_copies}
Fixture (other)
loto: ${d.loto}
Giga: ${d.giga}
Félicitation : ${d.felicitation}
Total/agt: ${d.total_agt}
Taux de change
Achat: ${d.achat}
Vente: ${d.vente}`;
}

// ============ GROUPES ============
const GROUPES = {
  gestion_center: {
    nom: 'Gestion Centers📢',
    numero: '120363027433348642@g.us',
  },
  s_check: {
    nom: 'S.check bn',
    numero: '243900435187-1560795042@g.us',
  },
  rate_fixture: {
    nom: 'Rates&Fixtures',
    numero: '243890177777-1574181414@g.us',
  },
};

// ============ QUESTIONS ============
const QUESTIONS = {
  gestion_center_matin: [
    { key: 'site',               q: '📍 Nom du shop ?' },
    { key: 'manager',            q: '👤 Manager présent ?' },
    { key: 'heure_ouv',          q: '🕐 Heure ouverture shop ?' },
    { key: 'premier_agent',      q: '🕐 Heure premier agent ?' },
    { key: 'teller',             q: '🕐 Heure ouverture teller ?' },
    { key: 'nom_premier_paye',   q: '👤 Nom premier ticket payé ?' },
    { key: 'heure_premier_paye', q: '🕐 Heure premier ticket payé ?' },
    { key: 'caissier_paye',      q: '👤 Caissier qui a payé ?' },
    { key: 'nb_caissiers',       q: '🔢 Caissières présentes/total ? (ex: 4/5)' },
    { key: 'equipe_caisse',      q: '📋 Liste équipe caisse (un nom par ligne) ?' },
    { key: 'pr',                 q: '🔢 Nombre PR ?' },
    { key: 'pr_equipe',          q: '👥 Noms équipe PR ?' },
    { key: 'center',             q: '🏢 Noms Center + Manager ?' },
    { key: 'bureau',             q: '✅ Bureau ok/NOK ?' },
    { key: 'couloir',            q: '✅ Couloir caisse ?' },
    { key: 'charging_room',      q: '✅ Charging room ?' },
    { key: 'salle',              q: '✅ Salle ?' },
    { key: 'connexion',          q: '✅ Connexion ?' },
    { key: 'onduleur',           q: '✅ Onduleur ?' },
    { key: 'flybox',             q: '✅ Flybox ?' },
    { key: 'caisse',             q: '✅ Caisse ?' },
    { key: 'page',               q: '🔢 Pages ?' },
    { key: 'ram',                q: '🔢 RAM ?' },
    { key: 'bico',               q: '✅ Plus bico ?' },
    { key: 'big_gen',            q: '🔢 Sous Big gén numéro ?' },
  ],
  gestion_center_soir: [
    { key: 'site',           q: '📍 Nom du shop ?' },
    { key: 'heure_ferm',     q: '🕐 Heure fermeture ?' },
    { key: 'dernier_ticket', q: '🎫 Dernier ticket ?' },
    { key: 'collecte',       q: '💰 Montant collecte ?' },
    { key: 'coffre',         q: '🔒 État coffre ?' },
    { key: 'rapport_caisse', q: '📊 Rapport caisse ?' },
    { key: 'etat_fin',       q: '📝 État fin journée ?' },
    { key: 'superviseur',    q: '👤 Superviseur présent ?' },
  ],
  s_check_matin: [{ key: 'collect', q: '💰 Montant collect coffre matin ?' }],
  s_check_soir:  [{ key: 'collect', q: '💰 Montant collect coffre soir ?' }],
  rate_fixture_matin: [
    { key: 'nb_pages',     q: '📄 Nombre de pages fixtures ?' },
    { key: 'nb_copies',    q: '📋 Copies par agent ?' },
    { key: 'loto',         q: '🎰 Loto (nombre) ?' },
    { key: 'giga',         q: '🎰 Giga (nombre) ?' },
    { key: 'felicitation', q: '🎉 Félicitation (nombre) ?' },
    { key: 'total_agt',    q: '🔢 Total par agent ?' },
    { key: 'achat',        q: '💵 Taux achat ?' },
    { key: 'vente',        q: '💵 Taux vente ?' },
  ],
};

// ============ ENVOI MESSAGE ============
async function envoyerMessage(jid, texte) {
  try {
    await sock.sendMessage(jid, { text: texte });
    console.log(`✅ Message envoyé à ${jid}`);
  } catch(e) {
    console.error(`❌ Erreur envoi à ${jid}:`, e.message);
  }
}

async function envoyerRapport(groupe_key, texte) {
  const groupe = GROUPES[groupe_key];
  await envoyerMessage(groupe.numero, texte);
  await envoyerMessage(CONFIG.MON_NUMERO + '@s.whatsapp.net',
    `✅ Rapport envoyé dans *${groupe.nom}*`);
}

// ============ MENU ============
function getMenu() {
  return `📋 *BOT RAPPORT KINKOLE*\n\n` +
    `1️⃣  Gestion Center - Matin\n` +
    `2️⃣  Gestion Center - Soir\n` +
    `3️⃣  S.Check - Matin\n` +
    `4️⃣  S.Check - Soir\n` +
    `5️⃣  Rates & Fixtures\n` +
    `──────────────\n` +
    `Envoie le numéro de ton choix.`;
}

// ============ TRAITEMENT MESSAGE ============
async function traiterMessage(jid, texte) {
  const state = getState();
  const msg = texte.trim().toUpperCase();
  const now = new Date();
  const date = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

  // Commandes globales
  if (['MENU', 'START', '0', 'BONJOUR', 'HI', 'AIDE'].includes(msg)) {
    resetState();
    await envoyerMessage(jid, getMenu());
    return;
  }
  if (['ANNULER', 'CANCEL', 'STOP'].includes(msg)) {
    resetState();
    await envoyerMessage(jid, '❌ Annulé. Envoie *menu* pour recommencer.');
    return;
  }

  // Confirmation
  if (state.etape === 'confirmation') {
    if (msg === 'OUI') {
      await envoyerRapport(state.groupe, state.rapport_final);
      resetState();
    } else {
      resetState();
      await envoyerMessage(jid, '❌ Annulé. Envoie *menu* pour recommencer.');
    }
    return;
  }

  // Sélection rapport
  if (!state.etape && state.etape !== 0) {
    const choix = {
      '1': { key: 'gestion_center_matin', groupe: 'gestion_center' },
      '2': { key: 'gestion_center_soir',  groupe: 'gestion_center' },
      '3': { key: 's_check_matin',        groupe: 's_check' },
      '4': { key: 's_check_soir',         groupe: 's_check' },
      '5': { key: 'rate_fixture_matin',   groupe: 'rate_fixture' },
    };

    const selection = choix[msg];
    if (!selection) {
      await envoyerMessage(jid, getMenu());
      return;
    }

    const questions = QUESTIONS[selection.key];
    setState({ etape: 0, rapport_key: selection.key, groupe: selection.groupe, data: { date } });
    await envoyerMessage(jid,
      `✅ *${selection.key.replace(/_/g,' ').toUpperCase()}*\n` +
      `${questions.length} questions. Réponds *annuler* à tout moment.\n\n` +
      `❓ (1/${questions.length}) ${questions[0].q}`
    );
    return;
  }

  // Q&R en cours
  const questions = QUESTIONS[state.rapport_key];
  state.data[questions[state.etape].key] = texte;
  state.etape++;

  if (state.etape < questions.length) {
    setState(state);
    await envoyerMessage(jid,
      `❓ (${state.etape + 1}/${questions.length}) ${questions[state.etape].q}`
    );
  } else {
    let rapport = '';
    if (state.rapport_key === 'gestion_center_matin') rapport = getModeleMatin(state.data);
    else if (state.rapport_key === 'gestion_center_soir') rapport = getModeleSoir(state.data);
    else if (state.rapport_key.startsWith('s_check')) rapport = getModeleSCheck(state.data);
    else if (state.rapport_key === 'rate_fixture_matin') rapport = getModeleRateFixture(state.data);

    setState({ ...state, etape: 'confirmation', rapport_final: rapport });
    await envoyerMessage(jid,
      `✅ *VÉRIFICATION AVANT ENVOI*\n\n${rapport}\n\n` +
      `──────────────\n` +
      `Envoie *OUI* pour confirmer ou *NON* pour annuler.`
    );
  }
}

// ============ CONNEXION WHATSAPP ============
async function connecterWhatsApp() {
  const { version } = await fetchLatestBaileysVersion();
  const { state: authState, saveCreds } = await useMultiFileAuthState('./auth_info');

  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    browser: ['Kinkole Bot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      global.currentQR = qr;
      global.botConnected = false;
      try {
        const code = await sock.requestPairingCode(process.env.WA_NUMBER || '243834543570');
        console.log('🔑 PAIRING CODE:', code);
        global.pairingCode = code;
      } catch(e) {
        console.log('Pairing code error:', e.message);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Connexion fermée. Reconnexion:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connecterWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connecté !');
      global.currentQR = null;
      global.pairingCode = null;
      global.botConnected = true;
      await envoyerMessage(CONFIG.MON_NUMERO + '@s.whatsapp.net',
        '🤖 *Bot Kinkole démarré !*\n\nEnvoie *menu* pour commencer.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.includes('@g.us')) continue; // ignorer groupes

      const expediteur = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      if (expediteur !== CONFIG.MON_NUMERO) continue; // seulement toi

      const texte = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text || '';
      if (!texte) continue;

      console.log(`📨 Message de ${expediteur}: ${texte}`);
      await traiterMessage(msg.key.remoteJid, texte);
    }
  });
}

// ============ SERVEUR HTTP (keep-alive Railway) ============
const server = http.createServer(async (req, res) => {
  if (global.botConnected) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">✅ Bot Kinkole connecté et actif !</h1>');
    return;
  }
  if (global.pairingCode) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="text-align:center;font-family:sans-serif;padding:40px">
      <h2>🤖 Bot Kinkole - Connexion</h2>
      <p>Entre ce code dans WhatsApp :</p>
      <h1 style="font-size:48px;letter-spacing:8px;color:#25D366">${global.pairingCode}</h1>
      <p>WhatsApp → ⋮ → Appareils connectés → Connecter avec numéro de téléphone</p>
      <p><small>Rafraîchis la page si le code expire</small></p>
      </body></html>
    `);
    return;
  }
  if (global.currentQR) {
    try {
      const qrImage = await QRCode.toDataURL(global.currentQR);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html><body style="text-align:center;font-family:sans-serif;padding:20px">
        <h2>🤖 Bot Kinkole - Scanner le QR Code</h2>
        <img src="${qrImage}" style="width:300px;height:300px"/>
        <p><small>Rafraîchis la page si le QR expire</small></p>
        </body></html>
      `);
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('QR code en cours de génération... Rafraîchis dans 5 secondes.');
    }
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot démarrage en cours... Rafraîchis dans 5 secondes.');
  }
});

server.listen(CONFIG.PORT, () => {
  console.log(`🌐 Serveur HTTP sur port ${CONFIG.PORT}`);
});

// ============ DÉMARRAGE ============
console.log('🚀 Démarrage Bot Kinkole...');
connecterWhatsApp();
