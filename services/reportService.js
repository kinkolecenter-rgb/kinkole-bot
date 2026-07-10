const config = require('../config');
const { getModeleMatin, getModeleSoir, getModeleSCheck, getModeleRateFixture } = require('./templates');

const userStates = new Map();
const getState = (jid) => userStates.get(jid) || {};
const setState = (jid, state) => userStates.set(jid, state);
const resetState = (jid) => userStates.delete(jid);

const GROUPES = {
    gestion_center: { nom: 'Gestion Centers📢', numero: '120363027433348642@g.us' },
    s_check:        { nom: 'S.check bn',        numero: '243900435187-1560795042@g.us' },
    rate_fixture:   { nom: 'Rates&Fixtures',    numero: '243890177777-1574181414@g.us' }
};

const QUESTIONS = {
    gestion_center_matin: [
        { key: 'site',              q: '📍 Nom du shop ?' },
        { key: 'manager',           q: '👤 Manager présent ?' },
        { key: 'heure_ouv',         q: '🕐 Heure ouverture shop ?' },
        { key: 'premier_agent',     q: '🕐 Heure premier agent ?' },
        { key: 'teller',            q: '🕐 Heure ouverture teller ?' },
        { key: 'nom_premier_paye',  q: '👤 Nom premier ticket payé ?' },
        { key: 'heure_premier_paye',q: '🕐 Heure premier ticket payé ?' },
        { key: 'caissier_paye',     q: '👤 Caissier qui a payé ?' },
        { key: 'nb_caissiers',      q: '🔢 Caissières présentes/total ? (ex: 4/5)' },
        { key: 'equipe_caisse',     q: '📋 Liste équipe caisse (un nom par ligne) ?' },
        { key: 'pr',                q: '🔢 Nombre PR ?' },
        { key: 'pr_equipe',         q: '👥 Noms équipe PR ?' },
        { key: 'center',            q: '🏢 Noms Center + Manager ?' },
        { key: 'bureau',            q: '✅ Bureau ok/NOK ?' },
        { key: 'couloir',           q: '✅ Couloir caisse ?' },
        { key: 'charging_room',     q: '✅ Charging room ?' },
        { key: 'salle',             q: '✅ Salle ?' },
        { key: 'connexion',         q: '✅ Connexion ?' },
        { key: 'onduleur',          q: '✅ Onduleur ?' },
        { key: 'flybox',            q: '✅ Flybox ?' },
        { key: 'caisse',            q: '✅ Caisse ?' },
        { key: 'page',              q: '🔢 Pages ?' },
        { key: 'ram',               q: '🔢 RAM ?' },
        { key: 'bico',              q: '✅ Plus bico ?' },
        { key: 'big_gen',           q: '🔢 Sous Big gén numéro ?' }
    ],
    gestion_center_soir: [
        { key: 'site',          q: '📍 Nom du shop ?' },
        { key: 'heure_ferm',    q: '🕐 Heure fermeture ?' },
        { key: 'dernier_ticket',q: '🎫 Dernier ticket ?' },
        { key: 'collecte',      q: '💰 Montant collecte ?' },
        { key: 'coffre',        q: '🔒 État coffre ?' },
        { key: 'rapport_caisse',q: '📊 Rapport caisse ?' },
        { key: 'etat_fin',      q: '📝 État fin journée ?' },
        { key: 'superviseur',   q: '👤 Superviseur présent ?' }
    ],
    s_check_matin: [{ key: 'collect', q: '💰 Montant collect coffre matin ?' }],
    s_check_soir:  [{ key: 'collect', q: '💰 Montant collect coffre soir ?' }],
    rate_fixture_matin: [
        { key: 'nb_pages',      q: '📄 Nombre de pages fixtures ?' },
        { key: 'nb_copies',     q: '📋 Copies par agent ?' },
        { key: 'loto',          q: '🎰 Loto (nombre) ?' },
        { key: 'giga',          q: '🎰 Giga (nombre) ?' },
        { key: 'felicitation',  q: '🎉 Félicitation (nombre) ?' },
        { key: 'total_agt',     q: '🔢 Total par agent ?' },
        { key: 'achat',         q: '💵 Taux achat ?' },
        { key: 'vente',         q: '💵 Taux vente ?' }
    ]
};

const CHOIX = {
    '1': { key: 'gestion_center_matin', groupe: 'gestion_center' },
    '2': { key: 'gestion_center_soir',  groupe: 'gestion_center' },
    '3': { key: 's_check_matin',        groupe: 's_check' },
    '4': { key: 's_check_soir',         groupe: 's_check' },
    '5': { key: 'rate_fixture_matin',   groupe: 'rate_fixture' }
};

const getMenu = () =>
`📋 *BOT RAPPORT KINKOLE*

1️⃣ Gestion Center - Matin
2️⃣ Gestion Center - Soir
3️⃣ S.Check - Matin
4️⃣ S.Check - Soir
5️⃣ Rates & Fixtures
──────────────
Envoie le numéro de ton choix.`;

const buildRapport = (key, data) => {
    if (key === 'gestion_center_matin') return getModeleMatin(data);
    if (key === 'gestion_center_soir')  return getModeleSoir(data);
    if (key.startsWith('s_check'))      return getModeleSCheck(data);
    if (key === 'rate_fixture_matin')   return getModeleRateFixture(data);
    return '';
};

module.exports = async function traiterMessage(sock, jid, texte) {
    const state = getState(jid);
    const msg = texte.trim().toUpperCase();
    const now = new Date();
    const date = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

    const send = async (dest, txt) => {
        try {
            await sock.sendMessage(dest, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi:', e);
        }
    };

    // Commandes globales
    if (['MENU', 'START', '0', 'BONJOUR', 'HI', 'AIDE'].includes(msg)) {
        resetState(jid);
        return send(jid, getMenu());
    }

    if (['ANNULER', 'CANCEL', 'STOP'].includes(msg)) {
        resetState(jid);
        return send(jid, '❌ Annulé. Envoie *menu* pour recommencer.');
    }

    // Confirmation finale
    if (state.etape === 'confirmation') {
        if (msg === 'OUI') {
            const groupe = GROUPES[state.groupe];
            await send(groupe.numero, state.rapport_final);
            await send(`${config.monNumero}@s.whatsapp.net`, `✅ Rapport envoyé dans *${groupe.nom}*`);
        } else {
            await send(jid, '❌ Annulé. Envoie *menu* pour recommencer.');
        }
        resetState(jid);
        return;
    }

    // Sélection du rapport
    if (state.etape === undefined) {
        const selection = CHOIX[msg];
        if (!selection) return send(jid, getMenu());

        const questions = QUESTIONS[selection.key];
        setState(jid, { etape: 0, rapport_key: selection.key, groupe: selection.groupe, data: { date } });
        return send(jid, `✅ *${selection.key.replace(/_/g,' ').toUpperCase()}*\n${questions.length} questions. Réponds *annuler* à tout moment.\n\n❓ (1/${questions.length}) ${questions[0].q}`);
    }

    // Collecte des réponses
    const questions = QUESTIONS[state.rapport_key];
    state.data[questions[state.etape].key] = texte;
    state.etape++;

    if (state.etape < questions.length) {
        setState(jid, state);
        return send(jid, `❓ (${state.etape+1}/${questions.length}) ${questions[state.etape].q}`);
    }

    // Toutes les réponses collectées
    const rapport = buildRapport(state.rapport_key, state.data);
    setState(jid, { ...state, etape: 'confirmation', rapport_final: rapport });
    return send(jid, `✅ *VÉRIFICATION AVANT ENVOI*\n\n${rapport}\n\n──────────────\nEnvoie *OUI* pour confirmer ou *NON* pour annuler.`);
};
