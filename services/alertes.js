const config = require('../config');
const { extraireUrgences, detecterTendances } = require('./analyseur');

module.exports = function creerAlertes(sock, memoire) {

    // 1. Alerte pour toi et le General Management (Urgences, Inactivité)
    const envoyerAlerte = async (txt) => {
        try {
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: txt });
            if (config.secondaireLid) {
                await sock.sendMessage(`${config.secondaireLid}@lid`, { text: txt });
            }
        } catch (e) {
            console.error('❌ Erreur alerte privée:', e.message);
        }
    };

    // 2. NOUVEAU : Envoi spécifique UNIQUEMENT dans Synchro Kinkole
    const envoyerRappelSynchro = async (txt) => {
        try {
            await sock.sendMessage('120363021280044937@g.us', { text: txt });
        } catch (e) {
            console.error('❌ Erreur rappel Synchro:', e.message);
        }
    };

    const verifierUrgences = async (message) => {
        try {
            const { analyserMessage } = require('./analyseur');
            const msgAnalyse = analyserMessage(message);

            if (msgAnalyse.priorite.niveau >= 4) {
                await envoyerAlerte(
                    `🚨 *URGENCE DÉTECTÉE*\n\n` +
                    `📍 Groupe: ${message.groupeNom}\n` +
                    `👤 De: ${message.expediteur}\n` +
                    `🕐 Heure: ${new Date().toLocaleTimeString('fr-FR')}\n\n` +
                    `💬 Message:\n${message.texte}`
                );
            }
        } catch (e) {
            console.error('❌ Erreur vérification urgence:', e.message);
        }
    };

    const verifierTendances = async () => {
        try {
            const messages = await memoire.getMessagesDepuis(1); // dernière heure
            if (messages.length < 5) return;

            const tendances = detecterTendances(messages);
            if (tendances.length === 0) return;

            await envoyerAlerte(
                `📊 *TENDANCES DÉTECTÉES*\n\n` +
                `${tendances.join('\n')}\n\n` +
                `🕐 ${new Date().toLocaleTimeString('fr-FR')}`
            );
        } catch (e) {
            console.error('❌ Erreur tendances:', e.message);
        }
    };

    const verifierInactivite = async () => {
        try {
            const messages = await memoire.getMessagesDepuis(2);
            if (messages.length === 0) {
                await envoyerAlerte(
                    `⚠️ *ALERTE INACTIVITÉ*\n\n` +
                    `Aucun message reçu depuis 2 heures dans les groupes surveillés.\n` +
                    `🕐 ${new Date().toLocaleTimeString('fr-FR')}`
                );
            }
        } catch (e) {}
    };

    // 3. NOUVEAU : Le cerveau anti-fausses alertes
    const verifierRapports = async () => {
        try {
            // On fouille dans la mémoire des 6 dernières heures
            const messages = await memoire.getMessagesDepuis(6);
            
            let ouvertureTrouvee = false;
            let fixturesTrouvees = false;
            let coffreTrouve = false;

            // On vérifie tous les messages stockés
            for (const msg of messages) {
                if (!msg.texte) continue;
                const txt = msg.texte.toLowerCase();
                
                if (txt.includes('ouverture du') || txt.includes('bonjour team')) ouvertureTrouvee = true;
                if (txt.includes('fixtures sport') || txt.includes('taux de change')) fixturesTrouvees = true;
                if (txt.includes('coffre ok') || txt.includes('état coffre')) coffreTrouve = true;
            }

            // Si tous les rapports importants sont là, ON NE FAIT RIEN (pas de relance !)
            if (ouvertureTrouvee && fixturesTrouvees && coffreTrouve) {
                console.log('✅ Tous les rapports matinaux sont présents. Aucune relance nécessaire.');
                return;
            }

            // Sinon, on prépare la relance avec uniquement ce qui manque
            let alerteMsg = `⚠️ *RAPPORTS MANQUANTS*\n`;
            let compteur = 1;
            if (!ouvertureTrouvee) alerteMsg += `${compteur++}. ❌ Rapport ouverture matin\n`;
            if (!fixturesTrouvees) alerteMsg += `${compteur++}. ❌ Fixtures & taux de change\n`;
            if (!coffreTrouve) alerteMsg += `${compteur++}. ❌ État coffre matin\n`;
            
            alerteMsg += `\n📢 Relance envoyée aux managers.`;

            // On envoie le message UNIQUEMENT dans Synchro Kinkole
            await envoyerRappelSynchro(alerteMsg);
            console.log('📢 Relance des rapports manquants envoyée dans Synchro.');

        } catch (e) {
            console.error('❌ Erreur vérification des rapports manquants:', e.message);
        }
    };

    const demarrerSurveillance = () => {
        setInterval(verifierTendances, 30 * 60 * 1000);
        setInterval(verifierInactivite, 2 * 60 * 60 * 1000);
        
        // Exécute la vérification intelligente toutes les heures
        setInterval(verifierRapports, 60 * 60 * 1000);

        console.log('🔔 Système d\'alertes démarré');
    };

    return {
        verifierUrgences,
        verifierTendances,
        verifierInactivite,
        verifierRapports,
        demarrerSurveillance,
        envoyerAlerte
    };
};
