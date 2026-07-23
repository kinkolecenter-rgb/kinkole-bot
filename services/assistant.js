/**
 * assistant.js — Orchestre tous les agents IA
 * Upgradé : Digital Twin, Mémoire permanente, Détection anomalies
 */

const config = require('../config');
const {
    agentIntention,
    agentIncidents,
    agentRapports,
    agentPerformance,
    agentRecherche,
    agentRecommandations,
    agentBrief,
    agentEtatCentre,
    agentProfilManager,
    agentAnomalies
} = require('./agents');
const db = require('./database');
const creerDigitalTwin      = require('./digitalTwin');
const creerMemoireManager   = require('./memoireManager');
const creerDetectionAnomalies = require('./detectionAnomalies');
const { formaterRapportCoffre } = require('./reportEngine');

module.exports = function creerAssistant(sock, memoire, contexte, redis) {

    // ── Modules upgradés ──────────────────────────────────────────────────────
    const twin      = creerDigitalTwin(redis);
    const memoMgr   = creerMemoireManager(redis);
    const anomalies = creerDetectionAnomalies(redis);

    const enAttente = new Map();

    const send = async (txt, jid = null) => {
        try {
            await sock.sendMessage(jid || `${config.monNumero}@s.whatsapp.net`, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi:', e.message);
        }
    };

    const sendVersGroupe = async (groupeId, txt) => {
        try { await sock.sendMessage(groupeId, { text: txt }); } catch (e) {}
    };

    const etatConversation = new Map();
    const setState   = (jid, data) => etatConversation.set(jid, data);
    const getState   = (jid) => etatConversation.get(jid);
    const resetState = (jid) => etatConversation.delete(jid);
    const getPeriodeHeures = (p) => ({ '3h': 3, '6h': 6, '12h': 12, '24h': 24, '48h': 48 }[p] || 3);

    // =========================================================
    // ✅ API PUBLIQUE — appelée depuis messageRouter
    // =========================================================

    /**
     * Notifier le Twin d'un rapport reçu (appelé depuis messageRouter après chaque rapport)
     */
    const notifierRapport = async (message, typeRapport) => {
        try {
            await twin.mettreAJourDepuisMessage(message, typeRapport);
            // Mémoire long terme manager
            if (message.expediteurJid) {
                await memoMgr.enregistrerRapport(message.expediteurJid, message.expediteur || 'Inconnu', typeRapport, message.texte || '');
            }
        } catch (e) {
            console.error('❌ notifierRapport:', e.message);
        }
    };

    /**
     * Notifier un incident (non-clôturé)
     */
    const notifierIncident = async (machineId, managerJid, nomManager) => {
        try {
            // Twin
            await twin.marquerIncidentResolu(machineId); // reset si existait déjà
            // Anomalies
            const alerte = await anomalies.enregistrerNonCloture(machineId, managerJid);
            if (alerte) {
                await send(`🔍 *ANOMALIE DÉTECTÉE*\n\n${alerte.message}`);
            }
            // Mémoire manager
            if (managerJid) {
                await memoMgr.enregistrerIncident(managerJid, nomManager || 'Inconnu', 'non_cloture');
                // Signal fraude si machine récurrente
                if (alerte && alerte.niveau === 'ÉLEVÉ') {
                    const alerteFraude = await anomalies.incrementerSignalFraude(managerJid, nomManager, `machine_${machineId}_recurrente`);
                    if (alerteFraude) await send(alerteFraude);
                }
            }
        } catch (e) {}
    };

    /**
     * Notifier résolution d'un incident
     */
    const notifierResolution = async (machineId, managerJid, nomManager, dureeH = null) => {
        try {
            await twin.marquerIncidentResolu(machineId);
            if (managerJid) await memoMgr.enregistrerResolution(managerJid, nomManager, dureeH);
        } catch (e) {}
    };

    /**
     * Notifier USD reçu
     */
    const notifierUSD = async (montant) => {
        try {
            await twin.enregistrerUSD(montant);
            const alerte = await anomalies.enregistrerUSD(montant);
            if (alerte) {
                await send(`🔍 *ANOMALIE USD*\n\n${alerte.message}`);
            }
        } catch (e) {}
    };

    // ── Commandes coffre/fixture (inchangées) ──────────────────────────────────
    const demanderCoffre = async () => {
        await send(`🔒 *ÉTAT DU COFFRE*\n\nMerci d'envoyer l'état du coffre maintenant.\nExemple :\n_Coffre ok hormis_\n_• Salaire_\n_• Collecte_`);
    };

    const demanderFixture = async () => {
        const messages = await memoire.getMessagesDepuis(null);
        const rapportOuverture = messages.find(m => m.texte?.includes('Ouverture du') || m.texte?.includes('Page :'));
        let nbPages = '?';
        if (rapportOuverture) {
            const match = rapportOuverture.texte.match(/[Pp]age\s*:\s*(\d+)/);
            if (match) nbPages = match[1];
        }
        await send(
            `📋 *FIXTURES — TAUX DE CHANGE*\n\nNb. Pages détectées : *${nbPages}*\n\n` +
            `Envoie :\n• Taux achat :\n• Taux vente :\n• Loto :\n• Giga :\n• Félicitation :`
        );
    };

    // ─────────────────────────────────────────────────────────
    // 🧠 TRAITEMENT DES COMMANDES TEXTE (Privé)
    // ─────────────────────────────────────────────────────────
    const traiterCommande = async (texte, jid) => {
        const cmd = texte.trim().toUpperCase();

        // ── Commandes rapides ─────────────────────────────────────────────────
        if (cmd === 'STATS DB') {
            try {
                const [nbMessages, nbReports, nbManagers] = await Promise.all([
                    db.prisma.message.count(),
                    db.prisma.report.count(),
                    db.prisma.manager.count()
                ]);
                await send(`📊 *STATISTIQUES SUPABASE*\n\n• Messages : *${nbMessages}*\n• Rapports : *${nbReports}*\n• Managers : *${nbManagers}*\n\n✅ PostgreSQL OK`, jid);
            } catch (e) {
                await send(`❌ Erreur DB : ${e.message}`, jid);
            }
            return true;
        }

        if (cmd === 'RESET' || cmd === 'EFFACER') {
            await contexte.viderHistorique(jid);
            await send('🗑️ Historique effacé.', jid);
            return true;
        }

        if (cmd === 'AIDE' || cmd === 'HELP') {
            await send(
                `🤖 *KINKOLE AI*\n\n` +
                `Tu peux parler naturellement :\n` +
                `💬 "Comment se porte le centre ?"\n` +
                `💬 "Y a-t-il des urgences ?"\n` +
                `💬 "Profil de Timothée"\n` +
                `💬 "Analyse les anomalies"\n` +
                `💬 "Bilan de la semaine"\n\n` +
                `📋 *Commandes rapides :*\n` +
                `• *centre* → état Digital Twin\n` +
                `• *incidents* → urgences actives\n` +
                `• *managers* →  équipe\n` +
                `• *anomalies* → détection fraude\n` +
                `• *reset* → effacer historique`,
                jid
            );
            return true;
        }

        // Shortcut "centre" → Digital Twin direct
        if (cmd === 'CENTRE' || cmd === 'ETAT' || cmd === 'TWIN') {
            const msg = await twin.repondreEtatCentre();
            await send(msg, jid);
            return true;
        }

        // Shortcut "anomalies"
        if (cmd === 'ANOMALIES') {
            await send('🔍 Analyse des anomalies en cours...', jid);
            const rapport = await anomalies.genererRapportAnomalies(config.managers);
            const reponse = await agentAnomalies(rapport);
            await send(reponse || rapport, jid);
            return true;
        }

        if (cmd.startsWith('APPROUVER ')) {
            const [, id, destination] = texte.trim().split(' ');
            if (!enAttente.has(id)) { await send('❌ ID rapport introuvable.', jid); return true; }
            const groupe = config.groupesDestination[destination];
            if (!groupe) { await send('❌ Destination invalide.\ngestion_center | s_check | rate_fixture', jid); return true; }
            await sendVersGroupe(groupe.id, enAttente.get(id).rapport);
            enAttente.delete(id);
            await send(`✅ Rapport envoyé dans *${groupe.nom}*`, jid);
            return true;
        }

        if (cmd === 'INCIDENTS' || cmd === 'URGENCES') {
            await send('🔍 Analyse...', jid);
            const historique = await contexte.getHistorique(jid);
            const messages   = await memoire.getMessagesDepuis(null);
            const etatJson   = await twin.genererResume();
            const reponse    = await agentIncidents(messages, historique, etatJson);
            await contexte.ajouterEchange(jid, 'user', texte);
            await contexte.ajouterEchange(jid, 'assistant', reponse);
            await send(reponse, jid);
            return true;
        }

        if (cmd === 'MANAGERS' || cmd === 'PERFORMANCE') {
            await send('📊 Analyse...', jid);
            const historique    = await contexte.getHistorique(jid);
            const messages      = await memoire.getMessagesDepuis(null);
            const resumeEquipe  = await memoMgr.getResumeEquipe(config.managers);
            const reponse       = await agentPerformance(messages, null, historique, resumeEquipe);
            await contexte.ajouterEchange(jid, 'user', texte);
            await contexte.ajouterEchange(jid, 'assistant', reponse);
            await send(reponse, jid);
            return true;
        }

        // =================================================================
        // 🏆 SHORTCUT : TOP VISITES (Moteur Local + IA)
        // =================================================================
        const texteMin = texte.toLowerCase();
        if (texteMin.includes('visite') && (texteMin.includes('top') || texteMin.includes('meilleur') || texteMin.includes('classement'))) {
            
            await send('🏆 Récupération du classement instantané...', jid);
            
            // 1. Le Moteur Local interroge la Vue SQL instantanément
            const topAgents = await db.getTopVisites();
            
            if (topAgents && topAgents.length > 0) {
                // 2. On prépare les données brutes pour l'IA
                const donneesBrutes = topAgents.map((a, i) => `${i + 1}. ${a.nom_manager || 'Inconnu'} : ${a.total_visites} visites`).join('\n');
                
                // 3. On utilise l'IA (agentRecherche fait très bien l'affaire) juste pour habiller le texte !
                const consigne = `Le Boss veut le top des visites. Voici les chiffres exacts de la Base de Données :\n\n${donneesBrutes}\n\nRédige une réponse courte, enthousiaste et très naturelle. Utilise des émojis (🥇🥈🥉 pour le podium). Ne mentionne JAMAIS que tu as lu une base de données.`;
                
                const historique = await contexte.getHistorique(jid);
                const reponseNaturelle = await agentRecherche(consigne, [], historique);
                
                await contexte.ajouterEchange(jid, 'user', texte);
                await contexte.ajouterEchange(jid, 'assistant', reponseNaturelle);
                await send(reponseNaturelle, jid);
            } else {
                await send("🕵️‍♂️ Boss, je n'ai trouvé aucune visite enregistrée pour le moment.", jid);
            }
            return true; // 👈 Le bot s'arrête ici, on a court-circuité l'analyse lourde !
        }
        // =================================================================

        // Coffre
        if (texte.toLowerCase().includes('coffre ok') || texte.toLowerCase().includes('coffre hormis')) {
            await sock.sendMessage(config.groupesDestination['s_check'].id, { text: texte });
            await send(`✅ Coffre envoyé dans *S Check*`, jid);
            return true;
        }

        // Fixture manuelle
        if (texte.toLowerCase().includes('taux achat') || texte.toLowerCase().includes('achat :')) {
            const messages = await memoire.getMessagesDepuis(null);
            const rapportOuverture = messages.find(m => m.texte?.includes('Ouverture du') || m.texte?.includes('Page :'));
            let nbPages = 9;
            if (rapportOuverture) {
                const match = rapportOuverture.texte.match(/[Pp]age\s*:\s*(\d+)/);
                if (match) nbPages = parseInt(match[1]);
            }
            const achat = texte.match(/[Aa]chat\s*:?\s*(\d+)/)?.[1] || '?';
            const vente = texte.match(/[Vv]ente\s*:?\s*(\d+)/)?.[1] || '?';
            const loto  = parseInt(texte.match(/[Ll]oto\s*:?\s*(\d+)/)?.[1] || '0');
            const giga  = parseInt(texte.match(/[Gg]iga\s*:?\s*(\d+)/)?.[1] || '0');
            const feli  = parseInt(texte.match(/[Ff]élicitation\s*:?\s*(\d+)/)?.[1] || '0');
            const total = (nbPages * 2) + loto + giga + feli;
            const rapportFixture =
                `Fixtures sport betting kinkole shop\nNb. Pages: ${nbPages}\nNb.Copies par agent: 2\n` +
                `Fixture (other)\nloto: ${loto}\nGiga: ${giga}\nFélicitation : ${feli}\nTotal/agt: ${total}\n` +
                `Taux de change\nAchat: ${achat}\nVente: ${vente}`;
            await send(`📋 *FIXTURE GÉNÉRÉE*\n\n${rapportFixture}\n\n──────────────\nEnvoie *OUI* pour publier dans Rates&Fixtures.`);
            setState(jid, { etape: 'confirmation_fixture', rapport_final: rapportFixture });
            return true;
        }

        if (cmd === 'OUI') {
            const state = getState(jid);
            if (state?.etape === 'confirmation_fixture') {
                await sock.sendMessage(config.groupesDestination['rate_fixture'].id, { text: state.rapport_final });
                await send(`✅ Fixture publiée dans *Rates&Fixtures*`);
                resetState(jid);
                return true;
            }
        }

        // ── Langage naturel ───────────────────────────────────────────────────
        await send('🤔 Analyse...', jid);
        const historique = await contexte.getHistorique(jid);
        const intention  = await agentIntention(texte, historique);
        console.log(`🧠 Intention: ${intention.intention} | Confiance: ${intention.confiance}`);

        let reponse = '';

        switch (intention.intention) {

            // 🆕 État temps réel via Digital Twin
            case 'etat_centre': {
                const etatMsg = await twin.repondreEtatCentre();
                const etatJson = await twin.genererResume();
                const messages = await memoire.getMessagesDepuis(null);
                const enrichi  = await agentEtatCentre(etatJson, messages, historique);
                reponse = enrichi || etatMsg; // fallback sur réponse Twin si IA down
                break;
            }

            // 🆕 Profil long terme d'un manager
            case 'profil_manager': {
                const nomMgr = intention.parametres?.manager;
                if (!nomMgr) { reponse = '❓ Précise le nom du manager.'; break; }
                // Trouver le JID par nom
                const entree = Object.entries(config.managers).find(([, v]) =>
                    v.nom.toLowerCase().includes(nomMgr.toLowerCase())
                );
                if (!entree) { reponse = `❓ Manager "${nomMgr}" non trouvé.`; break; }
                const [jidMgr, info] = entree;
                const profilTxt = await memoMgr.getResume(jidMgr, info.nom);
                reponse = await agentProfilManager(info.nom, profilTxt, historique);
                break;
            }

            // 🆕 Anomalies & fraude
            case 'anomalies': {
                const rapport = await anomalies.genererRapportAnomalies(config.managers);
                reponse = await agentAnomalies(rapport, historique) || rapport;
                break;
            }

            case 'brief': {
                const messages = await memoire.getMessagesDepuis(null);
                const etatJson = await twin.genererResume();
                reponse = await agentBrief(messages, historique, etatJson);
                break;
            }

            case 'incidents': {
                const messages = await memoire.getMessagesDepuis(null);
                const etatJson = await twin.genererResume();
                reponse = await agentIncidents(messages, historique, etatJson);
                break;
            }

            case 'performance': {
                const messages     = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                const nomMgr       = intention.parametres?.manager;
                // Si manager nommé, chercher son profil long terme
                let profilLong = null;
                if (nomMgr) {
                    const entree = Object.entries(config.managers).find(([, v]) =>
                        v.nom.toLowerCase().includes(nomMgr.toLowerCase())
                    );
                    if (entree) profilLong = await memoMgr.getResume(entree[0], entree[1].nom);
                }
                reponse = await agentPerformance(messages, nomMgr, historique, profilLong);
                break;
            }

            case 'rapport': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                const type     = intention.parametres?.type_rapport || 'journalier';
                reponse = await agentRapports(messages, type, historique);
                const id = Date.now().toString();
                enAttente.set(id, { rapport: reponse, type });
                reponse += `\n\n──────────────\n📤 *ID: ${id}*\nEnvoie *approuver ${id} [destination]* pour publier.`;
                break;
            }

            case 'recherche': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                reponse = await agentRecherche(intention.parametres?.question || texte, messages, historique);
                break;
            }

            case 'recommandation': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                const etatJson = await twin.genererResume();
                reponse = await agentRecommandations(messages, historique, etatJson);
                break;
            }

            case 'reset': {
                await contexte.viderHistorique(jid);
                reponse = '🗑️ Historique effacé.';
                break;
            }

            default: {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                reponse = await agentRecherche(texte, messages, historique);
                break;
            }
        }

        await contexte.ajouterEchange(jid, 'user', texte);
        await contexte.ajouterEchange(jid, 'assistant', reponse);

        const MAX_WA = 60000;
        if (reponse.length > MAX_WA) reponse = reponse.substring(0, MAX_WA) + '\n\n_[Réponse tronquée]_';
        await send(reponse, jid);
        return true;
    };

    // ── Brief automatique ─────────────────────────────────────────────────────
    const briefAutomatique = async () => {
        console.log('⏰ Brief automatique...');
        const messages = await memoire.getMessagesDepuis(null);
        if (messages.length === 0) return;
        const etatJson = await twin.genererResume();
        const reponse  = await agentBrief(messages, [], etatJson);
        await send(`⏰ *BRIEF — ${new Date().toLocaleTimeString('fr-FR', { timeZone: 'Africa/Kinshasa' })}*\n\n${reponse}`);
        // Snapshot horaire du Twin
        await twin.sauvegarderSnapshot();
    };

    // ── Vérification rapports manquants (existant, inchangé) ─────────────────
    const verifierRapportsManquants = async () => {
        const now   = new Date();
        const heure = now.getHours();
        if (heure >= 2 && heure < 9)   return;
        if (heure >= 14 && heure < 21) return;

        const limiteTemps  = now.getTime() - (16 * 60 * 60 * 1000);
        const tousMessages = await memoire.getTousMessages(200);
        const tous = tousMessages.filter(m => m.timestamp >= limiteTemps);

        const check = (fn) => tous.some(m => fn((m.texte || '').toLowerCase().replace(/\*/g, '').trim(), m));
        const manquantsManagers = [];
        const manquantsCoffre   = [];

        if (heure >= 9 && heure < 14) {
            if (!check(t => t.includes('ouverture du') || t.includes('bonjour team'))) {
                const db_ouv = await db.getReportsAujourdhui('ouverture');
                if (!db_ouv || db_ouv.length === 0) manquantsManagers.push('Rapport ouverture matin');
            }
            if (!check(t => t.includes('fixtures sport betting') || t.includes('taux de change'))) {
                const db_fix = await db.getReportsAujourdhui('fixture');
                if (!db_fix || db_fix.length === 0) manquantsManagers.push('Fixtures & taux de change');
            }
            const coffreMatin = check((t, m) => (t.includes('coffre ok') || t.includes('etat coffre')) && new Date(m.timestamp).getHours() < 15);
            const db_cof = await db.getReportsAujourdhui('coffre');
            if (!coffreMatin && (!db_cof || db_cof.length === 0)) manquantsCoffre.push('État coffre matin');
        }

        if (heure >= 22 || heure < 2) {
            if (!check(t => t.includes('dernier rapport'))) {
                const db_fer = await db.getReportsAujourdhui('fermeture');
                if (!db_fer || db_fer.length === 0) manquantsManagers.push('Dernier rapport soir');
            }
        }

        if (manquantsManagers.length > 0) {
            const alerteMsg = `⚠️ *RAPPORTS MANQUANTS*\n\n` +
                manquantsManagers.map((m, i) => `${i+1}. ❌ ${m}`).join('\n') +
                `\n\n📢 Prière d'envoyer les rapports manquants.`;
            await sendVersGroupe('120363021280044937@g.us', alerteMsg);
        }

        if (manquantsCoffre.length > 0) {
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                text: `🔒 *RAPPEL COFFRE*\n\n${manquantsCoffre[0]} non reçu.\n\nExemple : _Coffre ok hormis_`
            });
        }
    };

    return {
        traiterCommande,
        briefAutomatique,
        demanderCoffre,
        demanderFixture,
        verifierRapportsManquants,
        // API pour messageRouter
        notifierRapport,
        notifierIncident,
        notifierResolution,
        notifierUSD
    };
};
