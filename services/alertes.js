const config = require('../config');
const { extraireUrgences, detecterTendances } = require('./analyseur');

module.exports = function creerAlertes(sock, memoire) {

    const envoyerAlerte = async (txt) => {
        try {
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: txt });
            await sock.sendMessage(`${config.secondaireLid}@lid`, { text: txt });
        } catch (e) {
            console.error('❌ Erreur alerte:', e.message);
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

    const demarrerSurveillance = () => {
        // Vérifier tendances toutes les 30 minutes
        setInterval(verifierTendances, 30 * 60 * 1000);

        // Vérifier inactivité toutes les 2 heures
        setInterval(verifierInactivite, 2 * 60 * 60 * 1000);

        console.log('🔔 Système d\'alertes démarré');
    };

    return {
        verifierUrgences,
        verifierTendances,
        verifierInactivite,
        demarrerSurveillance,
        envoyerAlerte
    };
};
