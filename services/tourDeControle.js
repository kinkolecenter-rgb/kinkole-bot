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
        verifierRappelConnexion(sock, 12, "des Détails Connexion 12h", GROUPE_ALERTES);
    });

    // 4. Rappel Connexion 15h30
    cron.schedule('30 15 * * *', async () => {
        verifierRappelConnexion(sock, 15, "des Détails Connexion 15h", GROUPE_ALERTES);
    });

    // 5. Rappel Connexion 17h30
    cron.schedule('30 17 * * *', async () => {
        verifierRappelConnexion(sock, 17, "des Détails Connexion 17h", GROUPE_ALERTES);
    });
    
    // 6. Rappel Fermeture (22h30)
    cron.schedule('30 22 * * *', async () => {
        verifierEtRappeler(sock, 'fermeture', "de Fermeture (Dernier Rapport)", GROUPE_ALERTES);
    });

    // ==========================================
    // 🚨 7. RAPPELS INCIDENTS EN COURS (10h, 16h et 22h45)
    // ==========================================
    cron.schedule('0 10 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_ALERTES));
    cron.schedule('0 16 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_ALERTES));
    cron.schedule('45 22 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_ALERTES));

    // ==========================================
    // 🛑 8. VÉRIFICATION QUOTIDIENNE OBLIGATOIRE (23h00)
    // ==========================================
    cron.schedule('0 23 * * *', async () => verificationClotureQuotidienne(sock, GROUPE_ALERTES));

    // ==========================================
    // 👤 9. ESCALADE DIRECTE AU PATRON EN CAS DE SILENCE (23h59)
    // ==========================================
    cron.schedule('59 23 * * *', async () => alertePatronSilencieux(sock));
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
            
            await sock.sendMessage(groupeId, { text: messageAlerte });
            
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

/**
 * 🚨 Relance uniquement s'il y a des incidents ouverts (10h, 16h et 22h45)
 */
async function rappelerIncidentsActifs(sock, groupeId) {
    try {
        const incidents = await db.getIncidentsNonResolus();
        
        if (incidents && incidents.length > 0) {
            const idsConcernes = [...new Set(incidents.map(inc => inc.machineId))].join(', ');
            
            const phraseIds = incidents.length > 1 
                ? `les IDs *${idsConcernes}* n'ont pas clôturé` 
                : `l'ID *${idsConcernes}* n'a pas clôturé`;

            const msgRelance = `⚠️ *RAPPEL INCIDENT EN COURS* ⚠️\n\nRappel concernant ${phraseIds}.\n\n👉 Merci de faire une mise à jour (répondez avec l'ID suivi de *"résolu"*).`;
            await sock.sendMessage(groupeId, { text: msgRelance });
        }
    } catch (error) {
        console.error(`❌ Erreur rappel incidents :`, error.message);
    }
}

/**
 * 🛑 Le devoir quotidien strict de 23h00
 */
async function verificationClotureQuotidienne(sock, groupeId) {
    try {
        const incidents = await db.getIncidentsNonResolus();
        
        // CAS 1 : Il y a des incidents non résolus en DB, on exige le bilan final
        if (incidents && incidents.length > 0) {
            const idsConcernes = [...new Set(incidents.map(inc => inc.machineId))].join(', ');
            const msgBilan = `⚠️ *BILAN DE FIN DE JOURNÉE (23h00)* ⚠️\n\nLes machines suivantes sont toujours signalées non-clôturées : *${idsConcernes}*.\n\n👉 Quel est l'état final ? (répondez avec l'ID suivi de *"résolu"*).`;
            await sock.sendMessage(groupeId, { text: msgBilan });
        } 
        // CAS 2 : Aucun incident actif en DB
        else {
            // On vérifie si un manager a déjà validé la situation plus tôt (Logique Fixture)
            const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
            
            if (rapportsDuJour && rapportsDuJour.length > 0) {
                console.log(`✅ Bilan de clôture déjà reçu aujourd'hui par anticipation. Le bot reste silencieux.`);
            } else {
                // Silence radio total de l'équipe, le bot pose la question obligatoire
                const msgVerif = `⚠️ *VÉRIFICATION QUOTIDIENNE DE CLÔTURE (23h00)* ⚠️\n\nBonsoir cher manager.\nEst-ce que tout le monde a clôturé aujourd'hui ?\n\n👉 Si oui, répondez *"tout est ok"* ou *"clôture normale"*.\n👉 Si non, déclarez l'incident immédiatement (Format : *ID = Montant*).`;
                await sock.sendMessage(groupeId, { text: msgVerif });
            }
        }
    } catch (error) {
        console.error(`❌ Erreur vérification clôture 23h :`, error.message);
    }
}

/**
 * 👤 ESCALADE DIRECTE : Alerte privée pour toi à 23h59 si personne n'a répondu
 */
async function alertePatronSilencieux(sock) {
    try {
        const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
        
        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            const msgAlerte = `🚨 *ALERTE ROUGE - CLÔTURE INCONNUE* 🚨\n\nAttention Boss, l'équipe de nuit n'a jamais répondu à la vérification de clôture de 23h00.\n\nLe groupe est silencieux, le statut final de la journée n'a pas été validé par les managers.`;
            
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: msgAlerte });
            console.log(`🚨 Escalade envoyée au Boss : Clôture non validée !`);
        } else {
            console.log(`✅ Fin de journée validée, pas besoin d'alerter le patron.`);
        }
    } catch (error) {
        console.error(`❌ Erreur escalade patron 23h59 :`, error.message);
    }
}
/**
 * Vérifie si le rapport a été envoyé dans sa tranche horaire stricte
 */
async function verifierRappelConnexion(sock, heureCible, nomRapport, groupeId) {
    try {
        console.log(`🔍 Tour de Contrôle : Vérification horaire stricte pour [${nomRapport}]...`);
        
        const rapports = await db.getReportsAujourdhui('details_connexion');
        let rapportRecuDansLeCreneau = false;

        if (rapports && rapports.length > 0) {
            for (const r of rapports) {
                const heureRapport = new Date(r.timestamp).getHours();
                
                // 📦 Définition des tiroirs (Tranches horaires)
                let heureMin, heureMax;
                if (heureCible === 12) { heureMin = 11; heureMax = 13; } // Tiroir 12h : de 11h00 à 13h59
                if (heureCible === 15) { heureMin = 14; heureMax = 16; } // Tiroir 15h : de 14h00 à 16h29 (si on est à 15h30)
                if (heureCible === 17) { heureMin = 16; heureMax = 19; } // Tiroir 17h : de 16h30 à 19h59

                // Si le rapport a été envoyé dans cette tranche, c'est gagné !
                if (heureRapport >= heureMin && heureRapport <= heureMax) {
                    rapportRecuDansLeCreneau = true;
                    break; 
                }
            }
        }

        if (!rapportRecuDansLeCreneau) {
            const messageAlerte = `⚠️ *ALERTE MANAGER* ⚠️\n\nL'heure limite est dépassée.\nLe rapport *${nomRapport}* n'a toujours pas été reçu pour cette session.\n\n👉 Merci de l'envoyer immédiatement.`;
            
            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Rapport Manquant* : Le rapport ${nomRapport} est en retard.` 
            });
            console.log(`🚨 Alerte envoyée pour retard sur : ${nomRapport}`);
        } else {
            console.log(`✅ Le rapport [${nomRapport}] a bien été reçu dans sa tranche horaire.`);
        }
    } catch (error) {
        console.error(`❌ Erreur dans la Tour de Contrôle pour ${nomRapport}:`, error.message);
    }
}

module.exports = { initialiserTourDeControle };
