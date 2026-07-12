const cron = require('node-cron');
const config = require('../config');
const db = require('./database'); 

// 🎯 L'unique groupe où le bot a le droit de crier
const GROUPE_ALERTES = '120363021280044937@g.us'; // ID de Synchro Kinkole

function initialiserTourDeControle(sock) {
    console.log("🗼 Tour de Contrôle activée. Alertes configurées EXCLUSIVEMENT sur Synchro Kinkole...");

    // 1. Rappel Ouverture (09h00)
    cron.schedule('0 9 * * *', async () => {
        verifierEtRappeler(sock, 'ouverture', "d'Ouverture", GROUPE_ALERTES);
    });

    // 2. Rappel Fixture / Taux (10h00)
    cron.schedule('0 10 * * *', async () => {
        verifierEtRappeler(sock, 'fixture', "des Taux de change et Fixtures", GROUPE_ALERTES);
    });

    // 3. Rappel Connexion 12h30
    cron.schedule('30 12 * * *', async () => {
        verifierEtRappeler(sock, 'details_connexion', "des Détails Connexion 12h", GROUPE_ALERTES);
    });

    // 4. Rappel Connexion 15h30
    cron.schedule('30 15 * * *', async () => {
        verifierEtRappeler(sock, 'details_connexion', "des Détails Connexion 15h", GROUPE_ALERTES);
    });

    // 5. Rappel Connexion 17h30
    cron.schedule('30 17 * * *', async () => {
        verifierEtRappeler(sock, 'details_connexion', "des Détails Connexion 17h", GROUPE_ALERTES);
    });

    // 6. Rappel Fermeture (22h30)
    cron.schedule('30 22 * * *', async () => {
        verifierEtRappeler(sock, 'fermeture', "de Fermeture (Dernier Rapport)", GROUPE_ALERTES);
    });

    // 7. Rappel Non-Clôturés (23h00)
    cron.schedule('0 23 * * *', async () => {
        verifierEtRappeler(sock, 'incident_cloture', "des Non-Clôturés", GROUPE_ALERTES);
    });
}

/**
 * Fonction qui vérifie la DB et envoie un rappel si rien n'a été reçu aujourd'hui
 */
async function verifierEtRappeler(sock, typeRapport, nomRapport, groupeId) {
    try {
        console.log(`🔍 Tour de Contrôle : Vérification du rapport [${typeRapport}]...`);
        
        const rapportsDuJour = await db.getReportsAujourdhui(typeRapport);

        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            const messageAlerte = `⚠️ *ALERTE MANAGER* ⚠️\n\nL'heure limite est dépassée.\nLe rapport *${nomRapport}* n'a toujours pas été reçu dans le système.\n\nMerci de l'envoyer immédiatement pour la mise à jour des statistiques.`;
            
            // Envoi dans Synchro Kinkole
            await sock.sendMessage(groupeId, { text: messageAlerte });
            
            // Notification privée pour toi
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Rapport Manquant* : Le rapport ${nomRapport} est en retard.` 
            });
            console.log(`🚨 Alerte envoyée dans Synchro Kinkole pour le rapport : ${nomRapport}`);
        } else {
            console.log(`✅ Le rapport [${typeRapport}] a bien été reçu aujourd'hui. Aucun rappel nécessaire.`);
        }
    } catch (error) {
        console.error(`❌ Erreur dans la Tour de Contrôle pour ${typeRapport}:`, error.message);
    }
}

module.exports = { initialiserTourDeControle };
