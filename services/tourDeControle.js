const cron = require('node-cron');
const config = require('../config');
const db = require('./database'); 

const GROUPE_SYNCHRO  = '120363021280044937@g.us';
const GROUPE_DISPARUS = '243900435187-1564716535@g.us';

// Importé depuis messageRouter pour activer l'état d'attente après la question de 23h
let etatAttente = null;
let memoireRef = null;
let redisClient = null;
function setEtatAttente(ref) { etatAttente = ref; }

// Fix 4 : utilitaire pour tronquer les messages trop longs (limite WhatsApp ~65000 chars)
function tronquer(texte, max = 60000) {
    if (texte.length <= max) return texte;
    return texte.substring(0, max) + '\n\n_[Message tronqué — trop long]_';
}

function initialiserTourDeControle(sock, etatAttenteRef, memoire, redisClientRef) {
    etatAttente = etatAttenteRef;
    memoireRef = memoire;
    redisClient = redisClientRef || null;
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
}

/**
 * Vérifie la DB et envoie un rappel si le rapport n'a pas été reçu aujourd'hui
 * Cible uniquement les responsables réels en service entre 16h et 23h
 */
async function verifierEtRappeler(sock, typeRapport, nomRapport, groupeId) {
    try {
        console.log(`🔍 Tour de Contrôle : Vérification du rapport [${typeRapport}]...`);
        const rapportsDuJour = await db.getReportsAujourdhui(typeRapport);

        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            let responsable = '';
            try {
                const debutService = new Date();
                debutService.setHours(16, 0, 0, 0);
                const finService = new Date();
                finService.setHours(23, 0, 0, 0);

                const messagesService = await db.prisma.message.findMany({
                    where: { groupeJid: GROUPE_SYNCHRO, createdAt: { gte: debutService, lte: finService } },
                    select: { senderJid: true },
                    distinct: ['senderJid']
                });

                if (messagesService && messagesService.length > 0) {
                    const jidsEnService = messagesService.map(m => m.senderJid);
                    const managersActifs = await db.prisma.manager.findMany({
                        where: { jid: { in: jidsEnService } },
                        select: { nom: true }
                    });

                    if (managersActifs && managersActifs.length > 0) {
                        const noms = managersActifs.map(m => m.nom).join(', ');
                        responsable = `\n👤 *Responsables en service (16h-23h) :* ${noms}`;
                    }
                }
                
                if (!responsable) responsable = `\n👤 *Responsables en service :* Aucun manager détecté actif dans Synchro depuis 16h.`;

            } catch (e) {
                console.error('⚠️ Erreur filtrage managers en service:', e.message);
            }

            const messageAlerte = `⚠️ *ALERTE MANAGER* ⚠️\n\nL'heure limite est dépassée.\nLe rapport *${nomRapport}* n'a toujours pas été reçu.${responsable}\n\nMerci de l'envoyer immédiatement.`;
            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Rapport Manquant* : ${nomRapport} est en retard.${responsable}` 
            });
        } else {
            console.log(`✅ Rapport [${typeRapport}] reçu aujourd'hui. Aucun rappel.`);
        }
    } catch (error) {
        console.error(`❌ Erreur Tour de Contrôle [${typeRapport}]:`, error.message);
    }
}

/**
 * Rappels ciblés et groupés en un unique message compact
 */
async function rappelerIncidentsActifs(sock, groupeId) {
    try {
        const incidents = await db.getIncidentsNonResolus();
        
        if (!incidents || incidents.length === 0) return;

        const listeIds = [...new Set(incidents.map(inc => inc.machineId))];

        let msgRelance = `⚠️ *SUIVI MACHINES NON CLÔTURÉES* ⚠️\n\n`;
        msgRelance += `Il reste *${listeIds.length}* machine(s) en anomalie :\n`;
        listeIds.forEach(id => { msgRelance += `• *ID ${id}*\n`; });

        msgRelance += `\n🤖 *Action requise pour le Manager :*\n`;
        msgRelance += `Copiez et répondez avec le modèle ci-dessous pour mettre à jour les statuts :\n\n`;
        msgRelance += `*Modèle de réponse :*\n\`\`\`\nNon clôturé\n`;
        listeIds.forEach(id => { msgRelance += `${id} résolu\n`; });
        msgRelance += `\`\`\``;

        await sock.sendMessage(groupeId, { text: msgRelance });

        if (etatAttente) {
            etatAttente.set(groupeId, { etape: 'ATTENTE_FORMAT', timestamp: Date.now() });
        }
    } catch (error) {
        console.error(`❌ Erreur rappel incidents groupés :`, error.message);
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
            // Fix 5 : persister dans Redis pour survivre aux redémarrages
            if (redisClient) {
                try {
                    const data = {};
                    for (const [jid, etat] of etatAttente.entries()) data[jid] = etat;
                    await redisClient.set('etat_attente_synchro', JSON.stringify(data), 'EX', 7200);
                } catch (e) { console.error('⚠️ Erreur sauvegarde Redis etatAttente:', e.message); }
            }
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
