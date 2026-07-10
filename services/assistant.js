const config = require('../config');
const { genererBrief, repondreQuestion, preparerRapport } = require('./groq');

module.exports = function creerAssistant(sock, memoire) {

    const send = async (txt, dest = null) => {
        try {
            const cible = dest || `${config.monNumero}@s.whatsapp.net`;
            await sock.sendMessage(cible, { text: txt });
            // Envoyer aussi vers le secondaire si différent
            if (cible !== `${config.secondaireLid}@lid`) {
                await sock.sendMessage(`${config.secondaireLid}@lid`, { text: txt });
            }
        } catch (e) {
            console.error('❌ Erreur envoi assistant:', e.message);
        }
    };

    const sendVersGroupe = async (groupeId, txt) => {
        try {
            await sock.sendMessage(groupeId, { text: txt });
        } catch (e) {
            console.error('❌ Erreur envoi groupe:', e.message);
        }
    };

    // Etats pour approbation rapport
    const enAttente = new Map();

    const traiterCommande = async (texte, jid) => {
        const msg = texte.trim().toLowerCase();

        // BRIEF
        if (msg === 'brief' || msg === 'résumé' || msg === 'resume') {
            await send('⏳ Analyse en cours...');
            const messages = await memoire.getMessagesDepuis(3);
            const brief = await genererBrief(messages);
            await send(`📊 *BRIEF - ${new Date().toLocaleTimeString('fr-FR')}*\n\n${brief}`);
            return true;
        }

        // BRIEF ETENDU
        if (msg === 'brief 24h') {
            await send('⏳ Analyse des dernières 24h...');
            const messages = await memoire.getMessagesDepuis(24);
            const brief = await genererBrief(messages);
            await send(`📊 *BRIEF 24H*\n\n${brief}`);
            return true;
        }

        // PREPARER RAPPORT
        if (msg.startsWith('rapport ')) {
            const type = texte.substring(8).trim();
            await send(`⏳ Préparation du rapport "${type}"...`);
            const messages = await memoire.getMessagesDepuis(12);
            const rapport = await preparerRapport(type, messages);

            // Stocker en attente d'approbation
            const id = Date.now().toString();
            enAttente.set(id, { rapport, type });

            await send(`📋 *RAPPORT PRÊT - ID: ${id}*\n\n${rapport}\n\n──────────────\nEnvoie *approuver ${id} [gestion_center/s_check/rate_fixture]* pour envoyer.`);
            return true;
        }

        // APPROBATION
        if (msg.startsWith('approuver ')) {
            const parties = texte.trim().split(' ');
            const id = parties[1];
            const destination = parties[2];

            if (!enAttente.has(id)) {
                await send('❌ ID rapport introuvable.');
                return true;
            }

            const groupe = config.groupesDestination[destination];
            if (!groupe) {
                await send('❌ Destination invalide. Utilise: gestion_center, s_check ou rate_fixture');
                return true;
            }

            const { rapport } = enAttente.get(id);
            await sendVersGroupe(groupe.id, rapport);
            enAttente.delete(id);
            await send(`✅ Rapport envoyé dans *${groupe.nom}*`);
            return true;
        }

        // MESSAGES D'UN GROUPE
        if (msg.startsWith('messages ')) {
            const nomGroupe = texte.substring(9).trim();
            const messages = await memoire.getTousMessages(30);
            const filtres = messages.filter(m =>
                m.groupeNom.toLowerCase().includes(nomGroupe.toLowerCase())
            );

            if (filtres.length === 0) {
                await send(`📭 Aucun message trouvé pour "${nomGroupe}"`);
                return true;
            }

            const liste = filtres.slice(-20).map(m =>
                `[${new Date(m.timestamp).toLocaleTimeString('fr-FR')}] ${m.expediteur}: ${m.texte}`
            ).join('\n\n');

            await send(`📨 *Messages - ${nomGroupe}*\n\n${liste}`);
            return true;
        }

        // QUESTION LIBRE
        if (msg.startsWith('?') || msg.startsWith('question ')) {
            const question = texte.substring(msg.startsWith('?') ? 1 : 9).trim();
            await send('🤔 Recherche en cours...');
            const messages = await memoire.getMessagesDepuis(12);
            const reponse = await repondreQuestion(question, messages);
            await send(`💬 *Réponse*\n\n${reponse}`);
            return true;
        }

        // AIDE
        if (msg === 'aide' || msg === 'help') {
            await send(`🤖 *ASSISTANT KINKOLE*\n\n*Commandes disponibles :*\n\n📊 *brief* → résumé des 3 dernières heures\n📊 *brief 24h* → résumé des 24 dernières heures\n📋 *rapport [type]* → prépare un rapport\n✅ *approuver [id] [destination]* → envoie le rapport\n📨 *messages [groupe]* → voir messages d'un groupe\n❓ *? [question]* → poser une question\n📋 *menu* → bot rapports classique\n\n*Destinations :* gestion_center, s_check, rate_fixture`);
            return true;
        }

        return false; // pas une commande assistant
    };

    const briefAutomatique = async () => {
        console.log('⏰ Brief automatique...');
        const messages = await memoire.getMessagesDepuis(3);
        if (messages.length === 0) return;
        const brief = await genererBrief(messages);
        await send(`⏰ *BRIEF AUTOMATIQUE - ${new Date().toLocaleTimeString('fr-FR')}*\n\n${brief}`);
    };

    return { traiterCommande, briefAutomatique };
};
