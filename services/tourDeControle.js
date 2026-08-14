const cron = require('node-cron');
const config = require('../config');
const db = require('./database'); 
const { agentDialogueManager } = require('./agents'); // 🧠 Importation du cerveau conversationnel

const GROUPE_SYNCHRO  = '243906226846-1565006518@g.us';
const GROUPE_DISPARUS = '243900435187-1564716535@g.us';

// Importé depuis messageRouter pour activer l'état d'attente après la question de 23h
let etatAttente = null;
let memoireRef = null;
let redisClient = null;
function setEtatAttente(ref) { etatAttente = ref; }

// utilitaire pour tronquer les messages trop longs
function tronquer(texte, max = 60000) {
    if (texte.length <= max) return texte;
    return texte.substring(0, max) + '\n\n_[Message tronqué — trop long]_';
}

function initialiserTourDeControle(sock, etatAttenteRef, memoire, redisClientRef) {
    etatAttente = etatAttenteRef;
    memoireRef = memoire;
    redisClient = redisClientRef || null;
    console.log("🗼 Tour de Contrôle IA activée. Alertes configurées EXCLUSIVEMENT sur Synchro Kingasani...");

    const optionsCron = { timezone: 'Africa/Kinshasa' };

    // 1. Rappel Ouverture (08h30 - Marge de 30min)
    cron.schedule('30 8 * * *', async () => {
        verifierEtRappeler(sock, 'ouverture', "d'Ouverture", GROUPE_SYNCHRO);
    }, optionsCron);

    // 2. Rappel POS & Charging Room (10h30)
    cron.schedule('30 10 * * *', async () => {
        verifierEtRappeler(sock, 'pos', "des POS (et les raisons d'absences)", GROUPE_SYNCHRO);
        setTimeout(() => verifierEtRappeler(sock, 'video_charging', "la vidéo du charging room", GROUPE_SYNCHRO), 30000);
    }, optionsCron);

    // 3. Rappels États Actuels (09h30, 11h30, 13h30, 15h30, 17h30)
    const heuresEtats = [9, 11, 13, 15, 17];
    heuresEtats.forEach(h => {
        cron.schedule(`30 ${h} * * *`, async () => {
            verifierEtatActuel(sock, h, `d'État Actuel de ${h}h00`, GROUPE_SYNCHRO);
        }, optionsCron);
    });

    // 4. Rappel Connexion (12h30, 15h30, 17h30)
    cron.schedule('30 12 * * *', async () => verifierRappelConnexion(sock, 12, "des Détails Connexion 12h", GROUPE_SYNCHRO), optionsCron);
    cron.schedule('30 15 * * *', async () => verifierRappelConnexion(sock, 15, "des Détails Connexion 15h", GROUPE_SYNCHRO), optionsCron);
    cron.schedule('30 17 * * *', async () => verifierRappelConnexion(sock, 17, "des Détails Connexion 17h", GROUPE_SYNCHRO), optionsCron);
    
    // 5. Rappel Fermeture & Stocks (22h30)
    cron.schedule('30 22 * * *', async () => {
        verifierEtRappeler(sock, 'fermeture', "de Fermeture (et l'état des stocks)", GROUPE_SYNCHRO);
    }, optionsCron);

    // ==========================================
    // 🚨 6. RAPPELS INCIDENTS EN COURS (10h30, 16h30 et 22h45)
    // ==========================================
    cron.schedule('30 10 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO), optionsCron);
    cron.schedule('30 16 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO), optionsCron);
    cron.schedule('45 22 * * *', async () => rappelerIncidentsActifs(sock, GROUPE_SYNCHRO), optionsCron);

    // ==========================================
    // 🛑 7. VÉRIFICATION CLÔTURE QUOTIDIENNE (23h00)
    // ==========================================
    cron.schedule('0 23 * * *', async () => verificationClotureQuotidienne(sock, GROUPE_SYNCHRO), optionsCron);

    // ==========================================
    // 👤 8. ESCALADE DIRECTE AU PATRON (23h59)
    // ==========================================
    cron.schedule('59 23 * * *', async () => alertePatronSilencieux(sock), optionsCron);
}

/**
 * Utilitaire pour récupérer les numéros et les JIDs des managers actifs
 */
async function getManagersActifsData() {
    let jids = [];
    try {
        const heureActuelle = new Date().getHours();
        const debutService = new Date();
        debutService.setHours(heureActuelle < 14 ? 6 : 16, 0, 0, 0);
        
        const messagesService = await db.prisma.message.findMany({
            where: { groupeJid: GROUPE_SYNCHRO, timestamp: { gte: debutService, lte: new Date() } },
            select: { senderJid: true },
            distinct: ['senderJid']
        });

        if (messagesService && messagesService.length > 0) {
            jids = messagesService.map(m => m.senderJid);
        }
    } catch (e) {}
    
    if (jids.length === 0) jids = ['243000000000@s.whatsapp.net']; // Fallback
    
    // Extrait juste les numéros pour que l'IA puisse écrire @24389...
    const numeros = jids.map(j => j.split('@')[0]).join(' et @');
    
    return { jids, numeros };
}

/**
 * Vérifie la DB et envoie un rappel si le rapport n'a pas été reçu aujourd'hui
 */
async function verifierEtRappeler(sock, typeRapport, nomRapport, groupeId) {
    try {
        const rapportsDuJour = await db.getReportsAujourdhui(typeRapport);
        if (!rapportsDuJour || rapportsDuJour.length === 0) {
            const data = await getManagersActifsData();
            const sujet = `Le rapport ${nomRapport} est en retard. Relance-les poliment mais fermement pour qu'ils l'envoient immédiatement.`;
            const messageAlerte = await agentDialogueManager(sujet, data.numeros);
            
            await sock.sendMessage(groupeId, { text: messageAlerte, mentions: data.jids });
        }
    } catch (error) {}
}

async function verifierEtatActuel(sock, heureCible, nomRapport, groupeId) {
    try {
        const rapports = await db.getReportsAujourdhui('etat_actuel');
        const nombreTotalAujourdhui = rapports ? rapports.length : 0;
        let objectifRapports = 1;
        if (heureCible === 11) objectifRapports = 2;
        if (heureCible === 13) objectifRapports = 3;
        if (heureCible === 15) objectifRapports = 4;
        if (heureCible === 17) objectifRapports = 5;

        if (nombreTotalAujourdhui < objectifRapports) {
            const data = await getManagersActifsData();
            const sujet = `Le rapport ${nomRapport} est en retard (on en a reçu ${nombreTotalAujourdhui}/${objectifRapports}). Relance-les poliment.`;
            const messageAlerte = await agentDialogueManager(sujet, data.numeros);
            await sock.sendMessage(groupeId, { text: messageAlerte, mentions: data.jids });
        }
    } catch (error) {}
}

async function verifierRappelConnexion(sock, heureCible, nomRapport, groupeId) {
    try {
        const rapports = await db.getReportsAujourdhui('details_connexion');
        const nombreTotalAujourdhui = rapports ? rapports.length : 0;
        let objectifRapports = 1;
        if (heureCible === 12) objectifRapports = 1;
        if (heureCible === 15) objectifRapports = 2;
        if (heureCible === 17) objectifRapports = 3;

        if (nombreTotalAujourdhui < objectifRapports) {
            const data = await getManagersActifsData();
            const sujet = `Le rapport de ${nomRapport} est en retard (reçu ${nombreTotalAujourdhui}/${objectifRapports}). Relance-les poliment.`;
            const messageAlerte = await agentDialogueManager(sujet, data.numeros);
            await sock.sendMessage(groupeId, { text: messageAlerte, mentions: data.jids });
        }
    } catch (error) {}
}

/**
 * Rappels ciblés et groupés (Via IA + Format Forcé)
 */
async function rappelerIncidentsActifs(sock, groupeId) {
    try {
        const incidents = await db.getIncidentsNonResolus();
        if (!incidents || incidents.length === 0) return;

        const listeIds = [...new Set(incidents.map(inc => inc.machineId))];

        // REMPLACER le bloc sujet par :
        const maintenant = new Date();
        const incidentLePlusAncien = incidents.reduce((a, b) => 
            new Date(a.dateDeclaration) < new Date(b.dateDeclaration) ? a : b
        );
        const ageJours = Math.floor((maintenant - new Date(incidentLePlusAncien.dateDeclaration)) / (1000 * 60 * 60 * 24));
        const heure = maintenant.getHours();
        
        let sujet;
        if (ageJours === 0) {
            sujet = heure < 18
                ? `Rappeler poliment à l'équipe que ${listeIds.length} machine(s) avec reliquat aujourd'hui (IDs: ${listeIds.join(', ')}). Les inviter à envoyer leur mise à jour.`
                : `Signaler à l'équipe que les IDs ${listeIds.join(', ')} doivent être clôturés avant la fin de service ce soir. svp`;
        } else if (ageJours === 1) {
            sujet = `Signaler avec fermeté à l'équipe que les IDs ${listeIds.join(', ')} n'ont pas été clôturés hier et traînent encore aujourd'hui. C'est vraiment inaceptable. Une réponse est exigée maintenant.`;
        } else {
            sujet = `Interpeller l'équipe de manière très ferme : les IDs ${listeIds.join(', ')} sont non clôturés depuis ${ageJours} jours. Cette négligence est inacceptable et sera penalisés. Exiger une réponse définitive immédiate.`;
        }
        
        let msgRelance = await agentDialogueManager(sujet, "l'équipe");

        // On force le modèle à la fin pour sécuriser la BDD
        msgRelance += `\n\n🤖 *Action requise - Modèle de réponse :*\n\`\`\`\nNon clôturé\n`;
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
 */
async function verificationClotureQuotidienne(sock, groupeId) {
    try {
        const rapportsDuJour = await db.getReportsAujourdhui('incident_cloture');
        if (rapportsDuJour && rapportsDuJour.length > 0) {
            console.log(`✅ 23h00 : Rapport de clôture déjà reçu. Bot silencieux.`);
            return;
        }

        const incidents = await db.getIncidentsNonResolus();
        if (incidents && incidents.length > 0) {
            const idsConcernes = [...new Set(incidents.map(inc => inc.machineId))].join(', ');
            const msgBilan = `⚠️ *BILAN DE FIN DE JOURNÉE (23h00)* ⚠️\n\nLes machines suivantes sont toujours signalées non-clôturées : *${idsConcernes}*.\n\n👉 Quel est l'état final ?\n• Répondez *ID résolu* pour chaque machine clôturée\n• Ou signalez si la situation persiste`;
            await sock.sendMessage(groupeId, { text: msgBilan });
            return;
        }

        const msgVerif = `⚠️ *VÉRIFICATION QUOTIDIENNE DE CLÔTURE (23h00)* ⚠️\n\nBonsoir cher manager.\nEst-ce que tout le monde a clôturé aujourd'hui ?\n\n👉 Si oui : répondez *"Tout est ok"*\n👉 Si non : envoyez la liste selon ce modèle :\n\nNon clôturé\n421596 = 150000\n1363049 = 75000`;
        await sock.sendMessage(groupeId, { text: msgVerif });

        if (etatAttente) {
            etatAttente.set(groupeId, { etape: 'ATTENTE_REPONSE_23H', timestamp: Date.now() });
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
 * 👤 Escalade au patron à 23h59
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

module.exports = { initialiserTourDeControle, setEtatAttente };
