const config = require('../config');
const { getModeleMatin, getModeleSoir, getModeleSCheck, getModeleRateFixture } = require('./templates');

const userStates = new Map();
const getState = (jid) => userStates.get(jid) || {};
const setState = (jid, state) => userStates.set(jid, state);
const resetState = (jid) => userStates.delete(jid);

const GROUPES = config.groupesDestination;

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
        { key: 'nb_caissiers',       q: '🔢 Caissières présentes/total ?' },
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
        { key: 'big_gen',            q: '🔢 Sous Big gén numéro ?' }
    ],
    gestion_center_soir: [
        { key: 'site',           q: '📍 Nom du shop ?' },
        { key: 'heure_ferm',     q: '🕐 Heure fermeture ?' },
        { key: 'dernier_ticket', q: '🎫 Dernier ticket ?' },
        { key: 'collecte',       q: '💰 Montant collecte ?' },
        { key: 'coffre',         q: '🔒 État coffre ?' },
        { key: 'rapport_caisse', q: '📊 Rapport caisse ?' },
        { key: 'etat_fin',       q: '📝 État fin journée ?' },
        { key: 'superviseur',    q: '👤 Superviseur présent ?' }
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
        { key: 'vente',        q: '💵 Taux vente ?' }
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

    const send = async (txt) => {
        try {
            await sock.sendMessage(jid, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi:', e.message);
        }
    };

    if (['MENU', 'START', '0', 'BONJOUR', 'HI', 'AIDE'].includes(msg)) {
        resetState(jid);
        return send(getMenu());
    }

    if (['ANNULER', 'CANCEL', 'STOP'].includes(msg)) {
        resetState(jid);
        return send('❌ Annulé. Envoie *menu* pour recommencer.');
    }

    if (state.etape === 'confirmation') {
        if (msg === 'OUI') {
            const groupe = GROUPES[state.groupe];
            await sock.sendMessage(groupe.id, { text: state.rapport_final });
            await send(`✅ Rapport envoyé dans *${groupe.nom}*`);
        } else {
            await send('❌ Annulé. Envoie *menu* pour recommencer.');
        }
        resetState(jid);
        return;
    }

    if (state.etape === undefined) {
        const selection = CHOIX[msg];
        if (!selection) return send(getMenu());

        const questions = QUESTIONS[selection.key];
        setState(jid, { etape: 0, rapport_key: selection.key, groupe: selection.groupe, data: { date } });
        return send(`✅ *${selection.key.replace(/_/g,' ').toUpperCase()}*\n${questions.length} questions. Réponds *annuler* à tout moment.\n\n❓ (1/${questions.length}) ${questions[0].q}`);
    }

    const questions = QUESTIONS[state.rapport_key];
    state.data[questions[state.etape].key] = texte;
    state.etape++;

    if (state.etape < questions.length) {
        setState(jid, state);
        return send(`❓ (${state.etape+1}/${questions.length}) ${questions[state.etape].q}`);
    }

    const rapport = buildRapport(state.rapport_key, state.data);
    setState(jid, { ...state, etape: 'confirmation', rapport_final: rapport });
    return send(`✅ *VÉRIFICATION AVANT ENVOI*\n\n${rapport}\n\n──────────────\nEnvoie *OUI* pour confirmer ou *NON* pour annuler.`);
};
