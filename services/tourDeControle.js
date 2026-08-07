const cron = require('node-cron');
const config = require('../config');
const db = require('./database'); 
const { agentDialogueManager } = require('./agents'); // 🧠 Importation du cerveau conversationnel

const GROUPE_SYNCHRO  = '243906226846-1565006518@g.us';
const GROUPE_DISPARUS = '243900435187-1564716535@g.us';

// Importé depuis messageRouter pour activer l'état d'attente
let etatAttente = null;
let memoireRef = null;
let redisClient = null;
function setEtatAttente(ref) { etatAttente = ref; }

function tronquer(texte, max = 60000) {
    if (texte.length <= max) return texte;
    return texte.substring(0, max) + '\n\n_[Message tronqué — trop long]_';
}

function initialiserTourDeControle(sock, etatAttenteRef, memoire, redisClientRef) {
    etatAttente = etatAttenteRef;
    memoireRef = memoire;
    redisClient = redisClientRef || null;
    console.log("🗼 Tour de Contrôle IA activée. Le Bot-Manager surveille Kingasani avec 30 min de marge...");

    const optionsCron = { timezone: 'Africa/Kinshasa' };

    // ==========================================
    // ⏰ 1. RAPPEL D'OUVERTURE (08h30 - Marge de 30 min)
    // ==========================================
    cron.schedule('30 8 * * *', async () => {
        verifierEtRappeler(sock, 'ouverture', "le rapport d'ouverture", GROUPE_SYNCHRO);
    });

    // ==========================================
    // ⏰ 2. RAPPEL POS & VIDÉO CHARGING ROOM (10h30)
    // ==========================================
    cron.schedule('30 10 * * *', async () => {
        verifierEtRappeler(sock, 'pos', "le rapport des POS (avec les raisons des absences)", GROUPE_SYNCHRO);
        setTimeout(() => {
            verifierEtRappeler(sock, 'video_charging', "la vidéo du charging room", GROUPE_SYNCHRO);
        }, 30000); // 30 sec d'écart pour ne pas spammer
    });

    // ==========================================
    // ⏰ 3. RAPPELS ÉTATS ACTUELS (09h30, 11h30, 13h30, 15h30, 17h30)
    // ==========================================
    const heuresEtats = [9, 11, 13, 15, 17];
    heuresEtats.forEach(h => {
        cron.schedule(`30 ${h} * * *`, async () => {
            verifierEtRappeler(sock, 'etat_actuel', `le rapport d'état actuel de ${h}h00`, GROUPE_SYNCHRO);
        });
    });

    // ==========================================
    // ⏰ 4. RAPPELS DÉTAILS CONNEXION (12h30, 15h30, 17h30)
    // ==========================================
    cron.schedule('30 12 * * *', async () => verifierRappelConnexion(sock, 12, "les détails de connexion de 12h", GROUPE_SYNCHRO));
    cron.schedule('30 15 * * *', async () => verifierRappelConnexion(sock, 15, "les détails de connexion de 15h", GROUPE_SYNCHRO));
    cron.schedule('30 17 * * *', async () => verifierRappelConnexion(sock, 17, "les détails de connexion de 17h", GROUPE_SYNCHRO));
    
    // ==========================================
    // ⏰ 5. RAPPEL FERMETURE & STOCKS (22h30)
    // ==========================================
    cron.schedule('30 22 * * *', async () => {
        verifierEtRappeler(sock, 'fermeture', "le rapport de fermeture ET l'état des stocks", GROUPE_SYNCHRO);
    });

    // ==========================================
    // 🚨 6. RAPPELS INCIDENTS EN COURS (10h30, 16h30 et 22h45)
    // ==========================================
    cron.schedule('30 10 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO));
    cron.schedule('30 16 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO));
    cron.schedule('45 22 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO));

    // ==========================================
    // 🛑 7. VÉRIFICATION CLÔTURE QUOTIDIENNE (23h00)
    // ==========================================
    cron.schedule('0 23 * * *', async () => verificationClotureQuotidienne(sock, GROUPE_SYNCHRO));

    // ==========================================
    // 👤 8. ESCALADE DIRECTE AU PATRON (23h59)
    // ==========================================
    cron.schedule('59 23 * * *', async () => alertePatronSilencieux(sock));
}

/**
 * Vérifie la DB et envoie un rappel IA si le rapport n'a pas été reçu
 */
async function verifierEtRappeler(sock, typeRapport, nomRapport, groupeId) {
    try {
        console.log(`🔍 Tour de Contrôle : Vérification du rapport [${typeRapport}]...`);
        const rapportsDuJour = await db.getReportsAujourdhui(typeRapport);

        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            let responsable = "l'équipe"; // Par défaut
            try {
                // Recherche des managers actifs pour personnaliser le message
                const heureActuelle = new Date().getHours();
                const debutService = new Date();
                if (heureActuelle < 14) debutService.setHours(6, 0, 0, 0);
                else debutService.setHours(16, 0, 0, 0);
                
                const messagesService = await db.prisma.message.findMany({
                    where: { groupeJid: GROUPE_SYNCHRO, timestamp: { gte: debutService, lte: new Date() } },
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
                        responsable = managersActifs.map(m => m.nom).join(' et ');
                    }
                }
            } catch (e) { console.error('⚠️ Erreur filtrage managers:', e.message); }

            // 🧠 GÉNÉRATION DU MESSAGE PAR L'IA
            const sujet = `Le rapport "${nomRapport}" est en retard. Demande-leur de l'envoyer immédiatement, car c'est obligatoire dans la gestion journalière.`;
            const messageAlerte = await agentDialogueManager(sujet, responsable);

            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Retard signalé* : L'IA vient de relancer ${responsable} pour ${nomRapport}.` 
            });
        } else {
            console.log(`✅ Rapport [${typeRapport}] reçu aujourd'hui. Aucun rappel.`);
        }
    } catch (error) {
        console.error(`❌ Erreur Tour de Contrôle [${typeRapport}]:`, error.message);
    }
}

/**
 * Rappels ciblés et groupés via IA
 */
async function rappelerIncidentsActifs(sock, groupeId) {
    try {
        const incidents = await db.getIncidentsNonResolus();
        if (!incidents || incidents.length === 0) return;

        const listeIds = [...new Set(incidents.map(inc => inc.machineId))];
        
        // 🧠 Demande à l'IA de formuler la relance
        const sujet = `Il reste ${listeIds.length} machine(s) non-clôturées depuis hier (IDs: ${listeIds.join(', ')}). Demande-leur de répondre avec le modèle "ID résolu" ou "ID non résolu" pour mettre à jour la base de données.`;
        let msgRelance = await agentDialogueManager(sujet, "l'équipe");
        
        // On force le modèle à la fin pour être sûr qu'ils répondent bien
        msgRelance += `\n\n📝 *Rappel du modèle attendu :*\n${listeIds[0]} résolu`;

        await sock.sendMessage(groupeId, { text: msgRelance });

        if (etatAttente) {
            etatAttente.set(groupeId, { etape: 'ATTENTE_FORMAT', timestamp: Date.now() });
        }
    } catch (error) {
        console.error(`❌ Erreur rappel incidents groupés :`, error.message);
    }
}

/**
 * 🛑 Vérification clôture à 23h00 pile (Reste strict pour le format)
 */
async function verificationClotureQuotidienne(sock, groupeId) {
    try {
        const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
        if (rapportsDuJour && rapportsDuJour.length > 0) return;

        const incidents = await db.getIncidentsNonResolus();
        if (incidents && incidents.length > 0) {
            const idsConcernes = [...new Set(incidents.map(inc => inc.machineId))].join(', ');
            
            const sujet = `C'est l'heure du bilan de fin de journée (23h00). Les machines ${idsConcernes} sont toujours signalées non-clôturées. Demande-leur de donner l'état final.`;
            const msgBilan = await agentDialogueManager(sujet, "l'équipe");
            await sock.sendMessage(groupeId, { text: msgBilan });
            return;
        }

        const msgVerif = `⚠️ *VÉRIFICATION QUOTIDIENNE DE CLÔTURE (23h00)* ⚠️\n\nBonsoir l'équipe.\nEst-ce que tout le monde a clôturé aujourd'hui ?\n\n👉 Si oui : répondez *"Tout est ok"*\n👉 Si non : envoyez la liste selon ce modèle :\n\nNon clôturé\n421596 = 150000\n1363049 = 75000`;
        await sock.sendMessage(groupeId, { text: msgVerif });

        if (etatAttente) {
            etatAttente.set(groupeId, { etape: 'ATTENTE_REPONSE_23H', timestamp: Date.now() });
            if (redisClient) {
                try {
                    const data = {};
                    for (const [jid, etat] of etatAttente.entries()) data[jid] = etat;
                    await redisClient.set('etat_attente_synchro', JSON.stringify(data), 'EX', 7200);
                } catch (e) {}
            }
        }
    } catch (error) {
        console.error(`❌ Erreur vérification clôture 23h :`, error.message);
    }
}

/**
 * 👤 Escalade au patron à 23h59
 */
async function alertePatronSilencieux(sock) {
    try {
        const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            const msgAlerte = `🚨 *ALERTE ROUGE - CLÔTURE INCONNUE* 🚨\n\nBoss, l'équipe n'a jamais répondu à la vérification de clôture de 23h00. Le statut final de la journée n'est pas validé.`;
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: msgAlerte });
        }
    } catch (error) {
        console.error(`❌ Erreur escalade patron 23h59 :`, error.message);
    }
}

/**
 * Vérification rapports connexion par compteur
 */
async function verifierRappelConnexion(sock, heureCible, nomRapport, groupeId) {
    try {
        const rapports = await db.getReportsAujourdhui('details_connexion');
        const nombreTotalAujourdhui = rapports ? rapports.length : 0;

        let objectifRapports = 1;
        if (heureCible === 12) objectifRapports = 1;
        if (heureCible === 15) objectifRapports = 2;
        if (heureCible === 17) objectifRapports = 3;

        if (nombreTotalAujourdhui < objectifRapports) {
            // 🧠 Message naturel via IA
            const sujet = `Le rapport de ${nomRapport} est en retard (on en a reçu ${nombreTotalAujourdhui} sur ${objectifRapports} attendus). Relance-les poliment mais fermement pour qu'ils l'envoient tout de suite.`;
            const messageAlerte = await agentDialogueManager(sujet, "l'équipe");

            await sock.sendMessage(groupeId, { text: messageAlerte });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                text: `🚨 *Retard signalé* : L'IA vient de réclamer ${nomRapport}.` 
            });
        }
    } catch (error) {
        console.error(`❌ Erreur Tour de Contrôle [${nomRapport}]:`, error.message);
    }
}

module.exports = { initialiserTourDeControle, setEtatAttente };
