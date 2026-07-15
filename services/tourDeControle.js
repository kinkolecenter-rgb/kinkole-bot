const cron = require('node-cron');
const config = require('../config');
const db = require('./database'); 

const GROUPE_SYNCHRO  = '120363021280044937@g.us';
const GROUPE_DISPARUS = '243900435187-1564716535@g.us';

// Importé depuis messageRouter pour activer l'état d'attente après la question de 23h
let etatAttente = null;
function setEtatAttente(ref) { etatAttente = ref; }

function initialiserTourDeControle(sock, etatAttenteRef) {
    etatAttente = etatAttenteRef; // Référence partagée avec messageRouter
    console.log("🗼 Tour de Contrôle activée. Alertes configurées EXCLUSIVEMENT sur Synchro Kinkole...");

    // 1. Rappel Ouverture (09h00)
    cron.schedule('0 9 * * *', async () => {
        verifierEtRappeler(sock, 'ouverture', "d'Ouverture", GROUPE_SYNCHRO);
    });

    // 2. Rappel Fixture / Taux (10h00)
    cron.schedule('0 10 * * *', async () => {
        verifierEtRappeler(sock, 'fixture', "des Taux de change et Fixtures", GROUPE_SYNCHRO);
    });

    // 3. Rappel Connexion 12h30
    cron.schedule('30 12 * * *', async () => {
        verifierRappelConnexion(sock, 12, "des Détails Connexion 12h", GROUPE_SYNCHRO);
    });

    // 4. Rappel Connexion 15h30
    cron.schedule('30 15 * * *', async () => {
        verifierRappelConnexion(sock, 15, "des Détails Connexion 15h", GROUPE_SYNCHRO);
    });

    // 5. Rappel Connexion 17h30
    cron.schedule('30 17 * * *', async () => {
        verifierRappelConnexion(sock, 17, "des Détails Connexion 17h", GROUPE_SYNCHRO);
    });
    
    // 6. Rappel Fermeture (22h30)
    cron.schedule('30 22 * * *', async () => {
        verifierEtRappeler(sock, 'fermeture', "de Fermeture (Dernier Rapport)", GROUPE_SYNCHRO);
    });

    // ==========================================
    // 🚨 7. RAPPELS INCIDENTS EN COURS (10h, 16h et 22h45)
    //    → Un message ciblé par ID pour forcer une réponse précise
    // ==========================================
    cron.schedule('0 10 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO));
    cron.schedule('0 16 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO));
    cron.schedule('45 22 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO));

    // ==========================================
    // 🛑 8. VÉRIFICATION CLÔTURE QUOTIDIENNE (23h00)
    // ==========================================
    cron.schedule('0 23 * * *', async () => verificationClotureQuotidienne(sock, GROUPE_SYNCHRO));

    // ==========================================
    // 👤 9. ESCALADE DIRECTE AU PATRON (23h59)
    // ==========================================
    cron.schedule('59 23 * * *', async () => alertePatronSilencieux(sock));

    // TEST TEMPORAIRE — à supprimer après
        const maintenant = new Date();
        const minTest = maintenant.getMinutes() + 2;
        cron.schedule(`${minTest} ${maintenant.getHours()} * * *`, async () => {
            console.log("🧪 TEST : Déclenchement simulation 23h");
            verificationClotureQuotidienne(sock, GROUPE_SYNCHRO);
        });
}

/**
 * Vérifie la DB et envoie un rappel si le rapport n'a pas été reçu aujourd'hui
 */
async function verifierEtRappeler(sock, typeRapport, nomRapport, groupeId) {
    try {
        console.log(`🔍 Tour de Contrôle : Vérification du rapport [${typeRapport}]...`);
        const rapportsDuJour = await db.getReportsAujourdhui(typeRapport);

        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            const messageAlerte = `⚠️ *ALERTE MANAGER* ⚠️\n\nL'heure limite est dépassée.\nLe rapport *${nomRapport}* n'a toujours pas été reçu.\n\nMerci de l'envoyer immédiatement.`;
            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Rapport Manquant* : ${nomRapport} est en retard.` 
            });
        } else {
            console.log(`✅ Rapport [${typeRapport}] reçu aujourd'hui. Aucun rappel.`);
        }
    } catch (error) {
        console.error(`❌ Erreur Tour de Contrôle [${typeRapport}]:`, error.message);
    }
}

/**
 * 🚨 Rappels ciblés par ID (10h, 16h, 22h45) — Un message par ID pour forcer une réponse
 */
async function rappelerIncidentsActifs(sock, groupeId) {
    try {
        const incidents = await db.getIncidentsNonResolus();
        
        if (!incidents || incidents.length === 0) return;

        for (const inc of incidents) {
            const msgRelance = `⚠️ *SUIVI NON CLÔTURÉ* ⚠️\n\nEst-ce que l'ID *${inc.machineId}* a clôturé ?\n\n👉 Répondez :\n• *${inc.machineId} résolu* — si le problème est réglé\n• *${inc.machineId} non résolu* — si ça persiste`;
            await sock.sendMessage(groupeId, { text: msgRelance });
            // Pause entre chaque message pour éviter le spam
            await new Promise(r => setTimeout(r, 1500));
        }
    } catch (error) {
        console.error(`❌ Erreur rappel incidents :`, error.message);
    }
}

/**
 * 🛑 Vérification clôture à 23h00 pile
 * 
 * Logique :
 * - Si rapport déjà reçu avant 23h (anticipation) → silence
 * - Si incidents non résolus en DB → rappel ciblé sur ces IDs
 * - Si silence complet → question obligatoire + activation état d'attente
 */
async function verificationClotureQuotidienne(sock, groupeId) {
    try {
        // 1. Quelqu'un a-t-il déjà envoyé un rapport de clôture aujourd'hui ?
        const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
        if (rapportsDuJour && rapportsDuJour.length > 0) {
            console.log(`✅ 23h00 : Rapport de clôture déjà reçu par anticipation. Bot silencieux.`);
            return;
        }

        // 2. Y a-t-il des incidents non résolus en DB ?
        const incidents = await db.getIncidentsNonResolus();
        if (incidents && incidents.length > 0) {
            const idsConcernes = [...new Set(incidents.map(inc => inc.machineId))].join(', ');
            const msgBilan = `⚠️ *BILAN DE FIN DE JOURNÉE (23h00)* ⚠️\n\nLes machines suivantes sont toujours signalées non-clôturées : *${idsConcernes}*.\n\n👉 Quel est l'état final ?\n• Répondez *ID résolu* pour chaque machine clôturée\n• Ou signalez si la situation persiste`;
            await sock.sendMessage(groupeId, { text: msgBilan });
            return;
        }

        // 3. Silence complet → question obligatoire + on active l'état d'attente
        const msgVerif = `⚠️ *VÉRIFICATION QUOTIDIENNE DE CLÔTURE (23h00)* ⚠️\n\nBonsoir cher manager.\nEst-ce que tout le monde a clôturé aujourd'hui ?\n\n👉 Si oui : répondez *"Tout est ok"*\n👉 Si non : envoyez la liste selon ce modèle :\n\nNon clôturé\n421596 = 150000\n1363049 = 75000`;
        await sock.sendMessage(groupeId, { text: msgVerif });

        // Active l'état d'attente dans messageRouter pour intercepter la réponse
        if (etatAttente) {
            etatAttente.set(groupeId, { etape: 'ATTENTE_REPONSE_23H', timestamp: Date.now() });
            console.log(`🟡 État d'attente activé dans Synchro Kinkole après question 23h.`);
        }

    } catch (error) {
        console.error(`❌ Erreur vérification clôture 23h :`, error.message);
    }
}

/**
 * 👤 Escalade au patron à 23h59 si personne n'a répondu
 */
async function alertePatronSilencieux(sock) {
    try {
        const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
        
        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            const msgAlerte = `🚨 *ALERTE ROUGE - CLÔTURE INCONNUE* 🚨\n\nBoss, l'équipe n'a jamais répondu à la vérification de clôture de 23h00.\n\nLe statut final de la journée n'est pas validé.`;
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: msgAlerte });
            console.log(`🚨 Escalade envoyée au Boss : Clôture non validée.`);
        } else {
            console.log(`✅ Fin de journée validée. Pas d'alerte patron.`);
        }
    } catch (error) {
        console.error(`❌ Erreur escalade patron 23h59 :`, error.message);
    }
}

/**
 * Vérification rapports connexion par compteur (anti-retard)
 */
async function verifierRappelConnexion(sock, heureCible, nomRapport, groupeId) {
    try {
        console.log(`🔍 Vérification par compteur [${nomRapport}]...`);
        
        const rapports = await db.getReportsAujourdhui('details_connexion');
        const nombreTotalAujourdhui = rapports ? rapports.length : 0;

        let objectifRapports = 1;
        if (heureCible === 12) objectifRapports = 1;
        if (heureCible === 15) objectifRapports = 2;
        if (heureCible === 17) objectifRapports = 3;

        if (nombreTotalAujourdhui < objectifRapports) {
            const messageAlerte = `⚠️ *ALERTE MANAGER* ⚠️\n\nL'heure limite est dépassée.\nLe rapport *${nomRapport}* est en retard (${nombreTotalAujourdhui}/${objectifRapports} reçus).\n\n👉 Merci de l'envoyer immédiatement.`;
            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Rapport Manquant* : ${nomRapport} en retard (${nombreTotalAujourdhui}/${objectifRapports}).` 
            });
        } else {
            console.log(`✅ Objectif atteint : ${nombreTotalAujourdhui} rapport(s). Aucun retard.`);
        }
    } catch (error) {
        console.error(`❌ Erreur Tour de Contrôle [${nomRapport}]:`, error.message);
    }
}

module.exports = { initialiserTourDeControle, setEtatAttente };
