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

module.exports = function creerAssistant(sock, memoire, contexte) {

    const enAttente = new Map();

    const send = async (txt, jid = null) => {
        try {
            const cibles = [
                `${config.monNumero}@s.whatsapp.net`,
                `${config.secondaireLid}@lid`
            ];
            for (const cible of cibles) {
                try {
                    await sock.sendMessage(cible, { text: txt });
                } catch (e) {}
            }
        } catch (e) {
            console.error('❌ Erreur envoi:', e.message);
        }
    };

    const sendVersGroupe = async (groupeId, txt) => {
        try {
            await sock.sendMessage(groupeId, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi groupe:', e.message);
        }
    };

    const getPeriodeHeures = (periode) => {
        const map = { '3h': 3, '6h': 6, '12h': 12, '24h': 24, '48h': 48 };
        return map[periode] || 3;
    };

    const traiterCommande = async (texte, jid) => {
        const cmd = texte.trim().toUpperCase();

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

        await send(reponse, jid);
        return true;
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

    return { traiterCommande, briefAutomatique };
};
