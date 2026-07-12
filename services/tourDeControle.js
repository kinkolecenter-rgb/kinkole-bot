const cron = require('node-cron');
const config = require('../config');
const db = require('./database'); 

function initialiserTourDeControle(sock) {
    console.log("🗼 Tour de Contrôle activée. Surveillance des horaires en cours...");

    // 1. Rappel Ouverture (09h00)
    cron.schedule('0 9 * * *', async () => {
        verifierEtRappeler(sock, 'ouverture', "d'Ouverture", config.groupesDestination.gestion_center.id);
    });

    // 2. Rappel Fixture / Taux (10h00)
    cron.schedule('0 10 * * *', async () => {
        verifierEtRappeler(sock, 'fixture', "des Taux de change et Fixtures", '120363021280044937@g.us'); // Synchro Kinkole
    });

    // 3. Rappel Connexion 12h30
    cron.schedule('30 12 * * *', async () => {
        verifierEtRappeler(sock, 'details_connexion', "des Détails Connexion 12h", config.groupesDestination.gestion_center.id);
    });

    // 4. Rappel Connexion 15h30
    cron.schedule('30 15 * * *', async () => {
        verifierEtRappeler(sock, 'details_connexion', "des Détails Connexion 15h", config.groupesDestination.gestion_center.id);
    });

    // 5. Rappel Connexion 17h30
    cron.schedule('30 17 * * *', async () => {
        verifierEtRappeler(sock, 'details_connexion', "des Détails Connexion 17h", config.groupesDestination.gestion_center.id);
    });

    // 6. Rappel Fermeture (22h30)
    cron.schedule('30 22 * * *', async () => {
        verifierEtRappeler(sock, 'fermeture', "de Fermeture (Dernier Rapport)", config.groupesDestination.gestion_center.id);
    });

    // 7. Rappel Non-Clôturés (23h00)
    cron.schedule('0 23 * * *', async () => {
        verifierEtRappeler(sock, 'incident_cloture', "des Non-Clôturés", '243900435187-1564716535@g.us'); // Groupe Incidents
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
            const messageAlerte = `⚠️ *ALERTE TOUR DE CONTRÔLE* ⚠️\n\nL'heure limite est dépassée.\nLe rapport *${nomRapport}* n'a toujours pas été reçu dans le système.\n\nMerci aux managers concernés de l'envoyer immédiatement.`;
            
            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Rapport Manquant* : Le rapport ${nomRapport} est en retard.` 
            });
            console.log(`🚨 Alerte envoyée pour le rapport : ${nomRapport}`);
        } else {
            console.log(`✅ Le rapport [${typeRapport}] a bien été reçu aujourd'hui. Aucun rappel nécessaire.`);
        }
    } catch (error) {
        console.error(`❌ Erreur dans la Tour de Contrôle pour ${typeRapport}:`, error.message);
    }
}

module.exports = { initialiserTourDeControle };
