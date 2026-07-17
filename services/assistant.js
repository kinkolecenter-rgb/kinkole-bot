const config = require('../config');
const {
    agentIntention,
    agentIncidents,
    agentRapports,
    agentPerformance,
    agentRecherche,
    agentRecommandations,
    agentBrief
} = require('./agents');
const db = require('./database'); // 👈 AJOUT

module.exports = function creerAssistant(sock, memoire, contexte) {

    const enAttente = new Map();

    const send = async (txt, jid = null) => {
        try {
            // Fix 4 : envoi unique vers monNumero seulement (évite le double si secondaireLid = même téléphone)
            const cible = jid || `${config.monNumero}@s.whatsapp.net`;
            await sock.sendMessage(cible, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi:', e.message);
        }
    };

    // Ajoute cette fonction dans creerAssistant
        const demanderCoffre = async () => {
            console.log('⏰ Demande état coffre...');
            await send(
                `🔒 *ÉTAT DU COFFRE*\n\nMerci d'envoyer l'état du coffre maintenant.\nExemple :\n_Coffre ok hormis_\n_• Salaire_\n_• Collecte_`
            );
        };
        
        const demanderFixture = async () => {
            console.log('⏰ Demande fixture...');
            
            // Récupérer le rapport d'ouverture du jour pour extraire nb_pages
            const messages = await memoire.getMessagesDepuis(null);
            const rapportOuverture = messages.find(m => 
                m.texte?.includes('Ouverture du') || m.texte?.includes('Page :')
            );
            
            let nbPages = '?';
            if (rapportOuverture) {
                const match = rapportOuverture.texte.match(/[Pp]age\s*:\s*(\d+)/);
                if (match) nbPages = match[1];
            }
        
            await send(
                `📋 *FIXTURES — TAUX DE CHANGE*\n\n` +
                `Nb. Pages détectées depuis rapport ouverture : *${nbPages}*\n\n` +
                `Envoie uniquement :\n` +
                `• Taux achat :\n` +
                `• Taux vente :\n` +
                `• Loto (nombre) :\n` +
                `• Giga (nombre, 0 si absent) :\n` +
                `• Félicitation (nombre, 0 si absent) :`
            );
        };

    const sendVersGroupe = async (groupeId, txt) => {
        try {
            await sock.sendMessage(groupeId, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi groupe:', e.message);
        }
    };

    // Fix 1 : état par conversation (confirmation fixture, etc.)
    const etatConversation = new Map();
    const setState = (jid, data) => etatConversation.set(jid, data);
    const getState = (jid) => etatConversation.get(jid);
    const resetState = (jid) => etatConversation.delete(jid);

    const getPeriodeHeures = (periode) => {
        const map = { '3h': 3, '6h': 6, '12h': 12, '24h': 24, '48h': 48 };
        return map[periode] || 3;
    };

    

    const traiterCommande = async (texte, jid) => {
        const cmd = texte.trim().toUpperCase();

        // ── COMMANDE SECRÈTE DE TEST BASE DE DONNÉES ──
        if (cmd === 'STATS DB') {
            await send('🔍 Interrogation de la base de données (Supabase)...', jid);
            try {
                const nbMessages = await db.prisma.message.count();
                const nbReports = await db.prisma.report.count();
                const nbManagers = await db.prisma.manager.count();
                
                const statsMsg = `📊 *STATISTIQUES SUPABASE*\n\n` +
                                 `• Messages stockés : *${nbMessages}*\n` +
                                 `• Rapports structurés : *${nbReports}*\n` +
                                 `• Managers enregistrés : *${nbManagers}*\n\n` +
                                 `✅ La connexion PostgreSQL est parfaite !`;
                
                await send(statsMsg, jid);
            } catch (e) {
                await send(`❌ Erreur de lecture DB : ${e.message}`, jid);
            }
            return true;
        }

        // ── Commandes rapides sans IA ──
        if (cmd === 'RESET' || cmd === 'EFFACER') {
            await contexte.viderHistorique(jid);
            await send('🗑️ Historique de conversation effacé.', jid);
            return true;
        }

        if (cmd === 'AIDE' || cmd === 'HELP') {
            await send(
                `🤖 *KINKOLE AI — Assistant Center Manager*\n\n` +
                `Tu peux me parler naturellement :\n\n` +
                `💬 *"Comment se passe mon centre ?"*\n` +
                `💬 *"Y a-t-il des urgences ?"*\n` +
                `💬 *"Comment travaille Eric ?"*\n` +
                `💬 *"Que s'est-il passé ce matin ?"*\n` +
                `💬 *"Prépare un rapport journalier"*\n` +
                `💬 *"Qui parle des paiements ?"*\n` +
                `💬 *"Recommande moi quelque chose"*\n\n` +
                `📋 *Commandes rapides :*\n` +
                `• *menu* → bot rapports classique\n` +
                `• *incidents* → urgences détectées\n` +
                `• *managers* → performance équipe\n` +
                `• *reset* → effacer historique\n\n` +
                `📤 *Approbation rapport :*\n` +
                `• *approuver [id] [destination]*\n` +
                `• Destinations : gestion_center, s_check, rate_fixture`,
                jid
            );
            return true;
        }

        // Approbation rapport
        if (cmd.startsWith('APPROUVER ')) {
            const parties = texte.trim().split(' ');
            const id = parties[1];
            const destination = parties[2];

            if (!enAttente.has(id)) {
                await send('❌ ID rapport introuvable.', jid);
                return true;
            }

            const groupe = config.groupesDestination[destination];
            if (!groupe) {
                await send('❌ Destination invalide.\nUtilise: gestion_center, s_check ou rate_fixture', jid);
                return true;
            }

            const { rapport } = enAttente.get(id);
            await sendVersGroupe(groupe.id, rapport);
            enAttente.delete(id);
            await send(`✅ Rapport envoyé dans *${groupe.nom}*`, jid);
            return true;
        }

        // ── Commandes directes ──
        if (cmd === 'INCIDENTS' || cmd === 'URGENCES') {
            await send('🔍 Analyse des incidents en cours...', jid);
            const historique = await contexte.getHistorique(jid);
            const messages = await memoire.getMessagesDepuis(null); // ✅ pas d'intention ici
            const reponse = await agentIncidents(messages, historique);
            await contexte.ajouterEchange(jid, 'user', texte);
            await contexte.ajouterEchange(jid, 'assistant', reponse);
            await send(reponse, jid);
            return true;
        }
        
        if (cmd === 'MANAGERS' || cmd === 'PERFORMANCE') {
            await send('📊 Analyse des performances...', jid);
            const historique = await contexte.getHistorique(jid);
            const messages = await memoire.getMessagesDepuis(null); // ✅ pas d'intention ici
            const reponse = await agentPerformance(messages, null, historique);
            await contexte.ajouterEchange(jid, 'user', texte);
            await contexte.ajouterEchange(jid, 'assistant', reponse);
            await send(reponse, jid);
            return true;
        }

        // Ajoute dans traiterCommande, avant le bloc langage naturel
        // Détection réponse coffre
        if (texte.toLowerCase().includes('coffre ok') || texte.toLowerCase().includes('coffre hormis')) {
            const groupeDest = config.groupesDestination['s_check'];
            await sock.sendMessage(groupeDest.id, { text: texte });
            await send(`✅ État coffre envoyé dans *${groupeDest.nom}*`);
            return true;
        }
        
        // Détection réponse fixture (taux seulement)
        if (texte.toLowerCase().includes('taux achat') || texte.toLowerCase().includes('achat :')) {
            const messages = await memoire.getMessagesDepuis(null);
            
            // Récupérer infos depuis rapport ouverture
            const rapportOuverture = messages.find(m => 
                m.texte?.includes('Ouverture du') || m.texte?.includes('Page :')
            );
            
            let nbPages = 9; // défaut
            if (rapportOuverture) {
                const match = rapportOuverture.texte.match(/[Pp]age\s*:\s*(\d+)/);
                if (match) nbPages = parseInt(match[1]);
            }
        
            // Parser les taux envoyés
            const achatMatch = texte.match(/[Aa]chat\s*:?\s*(\d+)/);
            const venteMatch = texte.match(/[Vv]ente\s*:?\s*(\d+)/);
            const lotoMatch  = texte.match(/[Ll]oto\s*:?\s*(\d+)/);
            const gigaMatch  = texte.match(/[Gg]iga\s*:?\s*(\d+)/);
            const feliMatch  = texte.match(/[Ff]élicitation\s*:?\s*(\d+)/);
        
            const achat = achatMatch?.[1] || '?';
            const vente = venteMatch?.[1] || '?';
            const loto  = parseInt(lotoMatch?.[1] || '0');
            const giga  = parseInt(gigaMatch?.[1] || '0');
            const feli  = parseInt(feliMatch?.[1] || '0');
            
            // Calcul total/agent = (nb_pages * 2) + loto + giga + félicitation
            const totalAgt = (nbPages * 2) + loto + giga + feli;
        
            const rapportFixture = 
                `Fixtures sport betting kinkole shop\n` +
                `Nb. Pages: ${nbPages}\n` +
                `Nb.Copies par agent: 2\n` +
                `Fixture (other)\n` +
                `loto: ${loto}\n` +
                `Giga: ${giga}\n` +
                `Félicitation : ${feli}\n` +
                `Total/agt: ${totalAgt}\n` +
                `Taux de change\n` +
                `Achat: ${achat}\n` +
                `Vente: ${vente}`;
        
            // Afficher pour validation avant envoi
            await send(
                `📋 *FIXTURE GÉNÉRÉE*\n\n${rapportFixture}\n\n` +
                `──────────────\n` +
                `Envoie *OUI* pour publier dans Rates&Fixtures ou *NON* pour annuler.`
            );
            
            // Stocker en attente de confirmation
            setState(jid, { etape: 'confirmation_fixture', rapport_final: rapportFixture });
            return true;
        }
        
        // Confirmation fixture
        if (texte.trim().toUpperCase() === 'OUI') {
            const state = getState(jid);
            if (state?.etape === 'confirmation_fixture') {
                const groupeDest = config.groupesDestination['rate_fixture'];
                await sock.sendMessage(groupeDest.id, { text: state.rapport_final });
                await send(`✅ Fixture envoyée dans *${groupeDest.nom}*`);
                resetState(jid);
                return true;
            }
        }

        // ── Langage naturel via Agent Intention ──
        await send('🤔 Analyse en cours...', jid);

        const historique = await contexte.getHistorique(jid);
        const intention = await agentIntention(texte, historique);

        console.log(`🧠 Intention: ${intention.intention} | Confiance: ${intention.confiance}`);

        let reponse = '';
        const heures = getPeriodeHeures(intention.parametres?.periode);

        switch (intention.intention) {

            case 'brief': {
                const messages = await memoire.getMessagesDepuis(null);
                reponse = await agentBrief(messages, historique);
                break;
            }

            case 'incidents': {
                const messages = await memoire.getMessagesDepuis(null);
                reponse = await agentIncidents(messages, historique);
                break;
            }

            case 'performance': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                const manager = intention.parametres?.manager;
                reponse = await agentPerformance(messages, manager, historique);
                break;
            }

            case 'rapport': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                const type = intention.parametres?.type_rapport || 'journalier';
                reponse = await agentRapports(messages, type, historique);

                const id = Date.now().toString();
                enAttente.set(id, { rapport: reponse, type });
                reponse += `\n\n──────────────\n📤 *ID: ${id}*\nEnvoie *approuver ${id} [destination]* pour publier.`;
                break;
            }

            case 'recherche': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                const question = intention.parametres?.question || texte;
                reponse = await agentRecherche(question, messages, historique);
                break;
            }

            case 'recommandation': {
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                reponse = await agentRecommandations(messages, historique);
                break;
            }

            case 'reset': {
                await contexte.viderHistorique(jid);
                reponse = '🗑️ Historique effacé.';
                break;
            }

            default: {
                // Question libre → agent recherche
                const messages = await memoire.getMessagesDepuis(intention.parametres?.date || null);
                reponse = await agentRecherche(texte, messages, historique);
                break;
            }
        }

        // Sauvegarder dans le contexte
        await contexte.ajouterEchange(jid, 'user', texte);
        await contexte.ajouterEchange(jid, 'assistant', reponse);

        // Fix 16 : tronquer si trop long (limite WhatsApp ~65000 chars)
        const MAX_WHATSAPP = 60000;
        if (reponse.length > MAX_WHATSAPP) {
            reponse = reponse.substring(0, MAX_WHATSAPP) + '\n\n_[Réponse tronquée — trop longue]_';
        }

        await send(reponse, jid);
        return true;
    };

    // ============ SUIVI RAPPORTS ATTENDUS ============
    const rapportsAttendus = new Map(); // 👈 AJOUTE CETTE LIGNE ICI
    
    const verifierRapportsManquants = async () => {
    const now = new Date();
    const heure = now.getHours();
    
    // 🛑 FILTRE ANTI-SPAM : Pas de relance l'après-midi ni la nuit profonde
    if (heure >= 2 && heure < 9) return;
    if (heure >= 14 && heure < 21) return;

    // 🔥 CORRECTION DU PIÈGE DE MINUIT : On regarde les 16 dernières heures
    const limiteTemps = now.getTime() - (16 * 60 * 60 * 1000);

    const tousMessages = await memoire.getTousMessages(200);
    const msgsGestion  = await memoire.getMessages(config.groupesDestination.gestion_center.id, 50);
    const msgsSCheck   = await memoire.getMessages(config.groupesDestination.s_check.id, 50);
    const msgsFixture  = await memoire.getMessages(config.groupesDestination.rate_fixture.id, 50);
    
    const tous = [...tousMessages, ...msgsGestion, ...msgsSCheck, ...msgsFixture]
        .filter(m => m.timestamp >= limiteTemps);

    const check = (fn) => tous.some(m => {
        const texteNorm = (m.texte || '').toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
        return fn(texteNorm, m);
    });

    // On sépare ce qui est pour les managers et ce qui est pour toi
    const manquantsManagers = [];
    const manquantsCoffre = [];
    
    // ── RAPPORTS DU MATIN (Relances entre 9h et 13h) ──
    if (heure >= 9 && heure < 14) {
        if (!check(t => t.includes('ouverture du') || t.includes('bonjour team'))) {
            // Vérifier aussi en DB avant d'alerter
            const ouvertureDB = await db.getReportsAujourdhui('ouverture');
            if (!ouvertureDB || ouvertureDB.length === 0) {
                manquantsManagers.push('Rapport ouverture matin');
            }
        }
        if (!check(t => t.includes('fixtures sport betting') || t.includes('taux de change'))) {
            const fixtureDB = await db.getReportsAujourdhui('fixture');
            if (!fixtureDB || fixtureDB.length === 0) {
                manquantsManagers.push('Fixtures & taux de change');
            }
        }
        // Coffre matin : vérifier Redis ET DB
        const coffreMatin = check((t, m) => (t.includes('coffre ok') || t.includes('etat coffre')) && new Date(m.timestamp).getHours() < 15);
        const coffreMatinDB = await db.getReportsAujourdhui('coffre');
        if (!coffreMatin && (!coffreMatinDB || coffreMatinDB.length === 0)) {
            manquantsCoffre.push('État coffre matin');
        }
        // 🔥 SUIVI DES NON-CLÔTURÉS DE LA VEILLE (Se déclenche vers 10h)
        if (heure === 10) {
            const idsHier = global.idsNonCloturesHier || []; 
            if (idsHier.length > 0) {
                const rappelIncidents = `⚠️ *SUIVI DES NON-CLÔTURÉS D'HIER*\n\n` +
                                        `Les IDs suivants n'avaient pas clôturé hier soir : *${idsHier.join(', ')}*.\n\n` +
                                        `📢 Le problème est-il résolu ce matin ? Merci de confirmer.`;
                await sendVersGroupe('243900435187-1564716535@g.us', rappelIncidents);
                global.idsNonCloturesHier = [];
            }
        }
    }

    // ── RAPPORTS DU SOIR (Relances entre 21h et 01h du matin) ──
    if (heure >= 22 || heure < 2) {
        if (!check(t => t.includes('dernier rapport'))) {
            const fermetureDB = await db.getReportsAujourdhui('fermeture');
            if (!fermetureDB || fermetureDB.length === 0) {
                manquantsManagers.push('Dernier rapport soir');
            }
        }
        // Coffre soir : vérifier Redis ET DB
        const coffreSoir = check((t, m) => (t.includes('coffre ok') || t.includes('etat coffre')) && new Date(m.timestamp).getHours() >= 14);
        const coffreSoirDB = await db.getReportsAujourdhui('coffre');
        if (!coffreSoir && (!coffreSoirDB || coffreSoirDB.length === 0)) {
            manquantsCoffre.push('État coffre soir');
        }
        // ℹ️ La vérification clôture à 23h est gérée exclusivement par tourDeControle.js
    }

    // ==========================================
    // 1. ALERTE MANAGERS (Va dans SYNCHRO)
    // ==========================================
    if (manquantsManagers.length > 0) {
        const alerteMsg = `⚠️ *RAPPORTS MANQUANTS*\n\n` +
                          manquantsManagers.map((m, i) => `${i+1}. ❌ ${m}`).join('\n') +
                          `\n\n📢 Prière d'envoyer les rapports manquants avec le bon modèle.`;
        
        await sendVersGroupe('120363021280044937@g.us', alerteMsg);
        console.log('📢 Relance Managers envoyée dans Synchro Kinkole.');
    }

    // ==========================================
    // 2. ALERTE COFFRE (Va en PRIVÉ chez toi)
    // ==========================================
    if (manquantsCoffre.length > 0) {
        const alerteCoffre = `🔒 *RAPPEL COFFRE*\n\n` +
                             `Le rapport *${manquantsCoffre[0]}* n'a pas été détecté.\n\n` +
                             `Exemple à me renvoyer :\n_Coffre ok hormis_\n_• Salaire_\n_• Collecte_`;
        
        // Remplace `send` par l'envoi direct à ton numéro personnel
        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: alerteCoffre });
        console.log('🔒 Relance Coffre envoyée en privé.');
    }
};
    

    // ✅ briefAutomatique corrigé
    const briefAutomatique = async () => {
        console.log('⏰ Brief automatique...');
        const messages = await memoire.getMessagesDepuis(null); // aujourd'hui par défaut
        if (messages.length === 0) {
            console.log('📭 Pas de messages pour le brief');
            return;
        }
        const reponse = await agentBrief(messages);
        await send(`⏰ *BRIEF AUTOMATIQUE - ${new Date().toLocaleTimeString('fr-FR')}*\n\n${reponse}`);
    };

    return { 
    traiterCommande, 
    briefAutomatique, 
    demanderCoffre, 
    demanderFixture,
    verifierRapportsManquants  // ✅
    };
};
