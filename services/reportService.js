const config = require('../config');

const userStates = new Map();
function getState(jid) { return userStates.get(jid) || {}; }
function setState(jid, state) { userStates.set(jid, state); }
function resetState(jid) { userStates.delete(jid); }

// (J'ai regroupé tes modèles pour gagner de la place, mais c'est exactement ton texte)
const getModeleMatin = (d) => `Bonjour Team\n* Ouverture du ${d.date} shop ${d.site} par ${d.manager} ${d.heure_ouv}\n* Ouverture premier agent à ${d.premier_agent}\n* Ouverture teller à ${d.teller}\n* Premier ticket joué et payé\n     ------------------------------------\n* ${d.nom_premier_paye} : ${d.heure_premier_paye}\n* Premier ticket payé par ${d.caissier_paye} ${d.heure_premier_paye}\n* Nombre de caissière ${d.nb_caissiers}\n* Equipe matin caisse :\n     -------------------------------\n${d.equipe_caisse}\n* PR : ${d.pr}\n     ---------\n${d.pr_equipe}\n* Center ${d.center}\n\n      Etat Matériel\n       ---------------------\n* bureau ${d.bureau}\n* Couloir caisse ${d.couloir}\n* Charing room ${d.charging_room}\n* Salle ${d.salle}\n* Connexion ${d.connexion}\n* Onduleur ${d.onduleur}\n* Flybox ${d.flybox}\n* Caisse ${d.caisse}\n* Page : ${d.page}\n* ram : ${d.ram}\n* plus bico : ${d.bico}\n* Sous Big gén ${d.big_gen}`;
const getModeleSoir = (d) => `Bonsoir Team\n* Fermeture du ${d.date} shop ${d.site}\n* Heure fermeture : ${d.heure_ferm}\n* Dernier ticket : ${d.dernier_ticket}\n* Collecte : ${d.collecte}\n* Coffre : ${d.coffre}\n* Rapport caisse : ${d.rapport_caisse}\n* Etat fin journée : ${d.etat_fin}\n* Superviseur : ${d.superviseur}`;
const getModeleSCheck = (d) => `Coffre ok hormis\n* collect ${d.collect}`;
const getModeleRateFixture = (d) => `Fixtures sport betting kinkole shop\nNb. Pages: ${d.nb_pages}\nNb.Copies par agent: ${d.nb_copies}\nFixture (other)\nloto: ${d.loto}\nGiga: ${d.giga}\nFélicitation : ${d.felicitation}\nTotal/agt: ${d.total_agt}\nTaux de change\nAchat: ${d.achat}\nVente: ${d.vente}`;

const GROUPES = {
    gestion_center: { nom: 'Gestion Centers📢', numero: '120363027433348642@g.us' },
    s_check:        { nom: 'S.check bn',        numero: '243900435187-1560795042@g.us' },
    rate_fixture:   { nom: 'Rates&Fixtures',    numero: '243890177777-1574181414@g.us' }
};

const QUESTIONS = {
    gestion_center_matin: [ { key: 'site', q: '📍 Nom du shop ?' }, { key: 'manager', q: '👤 Manager présent ?' }, { key: 'heure_ouv', q: '🕐 Heure ouverture shop ?' }, { key: 'premier_agent', q: '🕐 Heure premier agent ?' }, { key: 'teller', q: '🕐 Heure ouverture teller ?' }, { key: 'nom_premier_paye', q: '👤 Nom premier ticket payé ?' }, { key: 'heure_premier_paye', q: '🕐 Heure premier ticket payé ?' }, { key: 'caissier_paye', q: '👤 Caissier qui a payé ?' }, { key: 'nb_caissiers', q: '🔢 Caissières présentes/total ? (ex: 4/5)' }, { key: 'equipe_caisse', q: '📋 Liste équipe caisse (un nom par ligne) ?' }, { key: 'pr', q: '🔢 Nombre PR ?' }, { key: 'pr_equipe', q: '👥 Noms équipe PR ?' }, { key: 'center', q: '🏢 Noms Center + Manager ?' }, { key: 'bureau', q: '✅ Bureau ok/NOK ?' }, { key: 'couloir', q: '✅ Couloir caisse ?' }, { key: 'charging_room', q: '✅ Charging room ?' }, { key: 'salle', q: '✅ Salle ?' }, { key: 'connexion', q: '✅ Connexion ?' }, { key: 'onduleur', q: '✅ Onduleur ?' }, { key: 'flybox', q: '✅ Flybox ?' }, { key: 'caisse', q: '✅ Caisse ?' }, { key: 'page', q: '🔢 Pages ?' }, { key: 'ram', q: '🔢 RAM ?' }, { key: 'bico', q: '✅ Plus bico ?' }, { key: 'big_gen', q: '🔢 Sous Big gén numéro ?' } ],
    gestion_center_soir: [ { key: 'site', q: '📍 Nom du shop ?' }, { key: 'heure_ferm', q: '🕐 Heure fermeture ?' }, { key: 'dernier_ticket', q: '🎫 Dernier ticket ?' }, { key: 'collecte', q: '💰 Montant collecte ?' }, { key: 'coffre', q: '🔒 État coffre ?' }, { key: 'rapport_caisse', q: '📊 Rapport caisse ?' }, { key: 'etat_fin', q: '📝 État fin journée ?' }, { key: 'superviseur', q: '👤 Superviseur présent ?' } ],
    s_check_matin: [{ key: 'collect', q: '💰 Montant collect coffre matin ?' }],
    s_check_soir:  [{ key: 'collect', q: '💰 Montant collect coffre soir ?' }],
    rate_fixture_matin: [ { key: 'nb_pages', q: '📄 Nombre de pages fixtures ?' }, { key: 'nb_copies', q: '📋 Copies par agent ?' }, { key: 'loto', q: '🎰 Loto (nombre) ?' }, { key: 'giga', q: '🎰 Giga (nombre) ?' }, { key: 'felicitation', q: '🎉 Félicitation (nombre) ?' }, { key: 'total_agt', q: '🔢 Total par agent ?' }, { key: 'achat', q: '💵 Taux achat ?' }, { key: 'vente', q: '💵 Taux vente ?' } ]
};

const getMenu = () => '📋 *BOT RAPPORT KINKOLE*\n\n1️⃣ Gestion Center - Matin\n2️⃣ Gestion Center - Soir\n3️⃣ S.Check - Matin\n4️⃣ S.Check - Soir\n5️⃣ Rates & Fixtures\n──────────────\nEnvoie le numéro de ton choix.';

// ============ LOGIQUE PRINCIPALE ============
// On ajoute "originalMsg" dans les paramètres
module.exports = async function traiterMessage(sock, jid, texte, originalMsg) {
    const state = getState(jid);
    const msgText = texte.trim().toUpperCase();
    const now = new Date();
    const date = String(now.getDate()).padStart(2,'0') + '/' + String(now.getMonth()+1).padStart(2,'0') + '/' + now.getFullYear();

    const envoyerMessage = async (dest, txt) => {
        try { 
            console.log(`\n📤 Envoi vers : ${dest}`);
            // Si c'est une réponse directe (au LID), on cite le message d'origine
            if (dest === jid && originalMsg) {
                await sock.sendMessage(dest, { text: txt }, { quoted: originalMsg });
            } else {
                // Pour les envois dans les groupes Kinkole, on envoie normalement
                await sock.sendMessage(dest, { text: txt });
            }
            console.log(`✅ Réponse envoyée et confirmée !`);
        } 
        catch(e) { 
            console.error(`❌ Échec de l'envoi:`, e); 
        }
    };

// --- CORRECTION : Utilisation de msgText au lieu de msg ---
    if (['MENU', 'START', '0', 'BONJOUR', 'HI', 'AIDE'].includes(msgText)) {
        resetState(jid);
        await envoyerMessage(jid, getMenu());
        return;
    }
    
    if (['ANNULER', 'CANCEL', 'STOP'].includes(msgText)) {
        resetState(jid);
        await envoyerMessage(jid, '❌ Annulé. Envoie *menu* pour recommencer.');
        return;
    }

    // Gestion de la confirmation finale
    if (state.etape === 'confirmation') {
        if (msgText === 'OUI') {
            const groupe = GROUPES[state.groupe];
            await envoyerMessage(groupe.numero, state.rapport_final);
            await envoyerMessage(`${config.monNumero}@s.whatsapp.net`, `✅ Rapport envoyé dans *${groupe.nom}*`);
            resetState(jid);
        } else {
            resetState(jid);
            await envoyerMessage(jid, '❌ Annulé. Envoie *menu* pour recommencer.');
        }
        return;
    }

    // Initialisation d'un nouveau rapport
    if (state.etape === undefined) {
        const choix = {
            '1': { key: 'gestion_center_matin', groupe: 'gestion_center' },
            '2': { key: 'gestion_center_soir',  groupe: 'gestion_center' },
            '3': { key: 's_check_matin',        groupe: 's_check' },
            '4': { key: 's_check_soir',         groupe: 's_check' },
            '5': { key: 'rate_fixture_matin',   groupe: 'rate_fixture' }
        };
        const selection = choix[msgText];
        if (!selection) { await envoyerMessage(jid, getMenu()); return; }
        
        const questions = QUESTIONS[selection.key];
        setState(jid, { etape: 0, rapport_key: selection.key, groupe: selection.groupe, data: { date } });
        await envoyerMessage(jid, `✅ *${selection.key.replace(/_/g,' ').toUpperCase()}*\n${questions.length} questions. Réponds *annuler* à tout moment.\n\n❓ (1/${questions.length}) ${questions[0].q}`);
        return;
    }

    const questions = QUESTIONS[state.rapport_key];
    state.data[questions[state.etape].key] = texte;
    state.etape++;

    if (state.etape < questions.length) {
        setState(jid, state);
        await envoyerMessage(jid, `❓ (${state.etape+1}/${questions.length}) ${questions[state.etape].q}`);
    } else {
        let rapport = '';
        if (state.rapport_key === 'gestion_center_matin') rapport = getModeleMatin(state.data);
        else if (state.rapport_key === 'gestion_center_soir') rapport = getModeleSoir(state.data);
        else if (state.rapport_key.startsWith('s_check')) rapport = getModeleSCheck(state.data);
        else if (state.rapport_key === 'rate_fixture_matin') rapport = getModeleRateFixture(state.data);

        setState(jid, { ...state, etape: 'confirmation', rapport_final: rapport });
        await envoyerMessage(jid, `✅ *VÉRIFICATION AVANT ENVOI*\n\n${rapport}\n\n──────────────\nEnvoie *OUI* pour confirmer ou *NON* pour annuler.`);
    }
};
