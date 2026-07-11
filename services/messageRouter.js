const config = require('../config');
const traiterMessage = require('./reportService');
const { detecterTypeRapport, verifierCompletude, getDestination } = require('./routeurRapports');
const db = require('./database'); // 👈 NOUVEAU : Import de la base de données

// Les groupes (nous les déplacerons dans config.js lors de la Phase 2)
const NOMS_GROUPES = {
    '120363021280044937@g.us': 'Synchro Kinkole',
    '120363023010071105@g.us': 'Synchro Kinkole pos',
    '120363025487823123@g.us': 'Winner Shop kinkole',
    '120363040045715280@g.us': 'Rapport PR terrain kinko',
    '243907634105-1540987363@g.us': 'PENALITy QS all shop',
    '243900435187-1521782366@g.us': 'General Management',
    '243900435187-1564931206@g.us': 'Évacuation Matériels shop',
    '243890011696-1509543437@g.us': 'Winner printing group',
    '120363039964661142@g.us': 'Printing Winner& Buco RDC',
    '243900435187-1560664753@g.us': 'Team Composition Shop',
    '243900435187-1543596785@g.us': 'MUKUMBUSU WINNER',
    '120363024619387743@g.us': 'Suivi Carburant Kinkole',
    '243900435187-1564716535@g.us': 'disparu,viré & no cloturé',
    '120363049897392666@g.us': 'Entre nous'
};

/**
 * Extrait le texte d'un message WhatsApp, peu importe son format (Média, Éphémère, etc.)
 */
function extraireTexte(msg) {
    const m = msg.message;
    if (!m) return '';
    
    // Gérer les messages éphémères ou à vue unique (qui encapsulent le vrai message)
    if (m.ephemeralMessage?.message) return extraireTexte({ message: m.ephemeralMessage.message });
    if (m.viewOnceMessage?.message) return extraireTexte({ message: m.viewOnceMessage.message });
    if (m.viewOnceMessageV2?.message) return extraireTexte({ message: m.viewOnceMessageV2.message });
    if (m.documentWithCaptionMessage?.message?.documentMessage) return m.documentWithCaptionMessage.message.documentMessage.caption || '';

    // Formats classiques
    return m.conversation || 
           m.extendedTextMessage?.text || 
           m.imageMessage?.caption || 
           m.videoMessage?.caption || 
           m.documentMessage?.caption || '';
}

/**
 * Fonction principale du routeur de messages
 */
async function handleIncomingMessage(sock, { messages, type }, memoire, assistant) {
    if (type !== 'notify') return;

    for (const msg of messages) {
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;

        // 1. TRAITEMENT DES MESSAGES DE GROUPES
        if (jid.includes('@g.us') && config.groupesSurveilles.includes(jid)) {
            await gererMessageGroupe(sock, msg, jid, memoire);
            continue;
        }

        // 2. TRAITEMENT DES MESSAGES PRIVÉS
        if (!jid.includes('@g.us')) {
            await gererMessagePrive(sock, msg, jid, assistant);
        }
    }
}

/**
 * Gère la logique des messages reçus dans les groupes
 */
async function gererMessageGroupe(sock, msg, jid, memoire) {
    const participantJid = msg.key.participant || msg.key.remoteJid || '';
    const expediteur = msg.pushName || participantJid.split('@')[0] || 'Inconnu';

    const texteBrut = extraireTexte(msg);
    const estMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage || msg.message?.documentWithCaptionMessage);
    const texteStocke = estMedia && !texteBrut ? '[Média sans légende]' : texteBrut;

    if (!texteBrut) return; // Ignore les stickers, vocaux ou documents sans texte

    // NORMALISATION : Minuscules, suppression des astérisques et réduction des espaces multiples
    const texteNormalise = texteBrut.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

    console.log(`📌 EXPEDITEUR | JID: ${participantJid} | Nom: ${expediteur} | Texte: ${texteNormalise.substring(0, 50)}...`);

    // Sauvegarde en mémoire Redis
    await memoire.sauvegarderMessage(jid, {
        groupeJid: jid,
        groupeNom: NOMS_GROUPES[jid] || jid,
        expediteurJid: participantJid,
        expediteur,
        texte: texteStocke,
        estMedia,
        timestamp: Date.now()
    });

    // 👈 NOUVEAU : Sauvegarde dans PostgreSQL (Nouveau système)
    try {
        await db.upsertManager(participantJid, expediteur); // Enregistre ou met à jour le manager
        await db.sauvegarderMessage(jid, participantJid, texteStocke, estMedia); // Sauvegarde le message
    } catch (e) {
        console.error('⚠️ Erreur écriture PostgreSQL ignorée pour le moment:', e.message);
    }

    // ── DÉTECTION ROBUSTE DE RAPPORTS ──
    const estProbablementRapport = (
        texteNormalise.includes('ouverture du') ||
        texteNormalise.includes('bonjour team') ||
        texteNormalise.includes('dernier rapport') ||
        texteNormalise.includes('coffre ok') ||
        texteNormalise.includes('fixtures sport betting') ||
        texteNormalise.includes('détails connexion') ||
        texteNormalise.includes('connexion 12h') ||
        texteNormalise.includes('connexion 15h') ||
        texteNormalise.includes('connexion 17h') ||
        texteNormalise.includes('ids connecté') ||
        texteNormalise.includes('team composition') ||
        texteNormalise.includes('rapport pos') ||
        texteNormalise.includes('rapport reste caution') ||
        texteNormalise.includes('état d activités') ||
        texteNormalise.includes('etat d activites') || // Sans accent au cas où
        texteNormalise.includes('etat materiel') ||
        texteNormalise.includes('non clôture')
    );

    if (estProbablementRapport) {
        // On passe texteBrut au routeur (pour ne pas casser d'éventuelles regex existantes)
        const detection = await detecterTypeRapport(texteBrut);
        console.log(`🔍 Détection: ${detection.type} | est_rapport: ${detection.est_rapport}`);

        if (detection.est_rapport && detection.type !== 'inconnu') {
            const manager = config.managers[participantJid] || { nom: expediteur };
            const destination = getDestination(detection.type);

            if (destination) {
                const groupeDest = config.groupesDestination[destination];
                console.log(`📋 Rapport ${detection.type} de ${manager.nom} → ${groupeDest.nom}`);

                const completude = await verifierCompletude(texteBrut, detection.type);

                if (completude.complet) {
                    await sock.sendMessage(groupeDest.id, { text: texteBrut });
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                        text: `✅ *${detection.type.toUpperCase()}* de *${manager.nom}* → *${groupeDest.nom}*`
                    });
                } else {
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                        text: `⚠️ *${detection.type.toUpperCase()}* de *${manager.nom}* incomplet.\n\n` +
                              `❌ Manquants :\n${completude.manquants.map(m => `• ${m}`).join('\n')}\n\n` +
                              `📍 Reçu dans : *${NOMS_GROUPES[jid]}*`
                    });
                }
            }
        }
    }
}

/**
 * Gère la logique des messages privés
 */
async function gererMessagePrive(sock, msg, jid, assistant) {
    const texte = extraireTexte(msg);

    if (!texte) return;

    const expediteur = jid.split('@')[0].split(':')[0];
    const autorise = [
        String(config.monNumero),
        String(config.monLid),
        String(config.secondaireLid),
        String(config.secondaireNumero)
    ].filter(Boolean);

    if (!autorise.includes(expediteur)) return;

    if (texte.trim().toUpperCase() === 'PING') {
        await sock.sendMessage(jid, { text: 'PONG ✅' });
        return;
    }

    await sock.readMessages([msg.key]);
    await sock.sendPresenceUpdate('composing', jid);

    const cmd = texte.trim().toUpperCase();

    // Commandes rapides (sans IA)
    if (['MENU', 'START', '0', 'BONJOUR', 'HI', 'ANNULER', 'CANCEL', 'STOP', 'OUI', 'NON'].includes(cmd) ||
        ['1','2','3','4','5'].includes(cmd)) {
        await traiterMessage(sock, jid, texte);
        return;
    }

    // Commandes assistant avec IA
    const traitePar = await assistant.traiterCommande(texte, jid);
    if (!traitePar) {
        await traiterMessage(sock, jid, texte);
    }
}

module.exports = { handleIncomingMessage };
