const config = require('../config');
const traiterMessage = require('./reportService');
const { detecterTypeRapport, verifierCompletude, getDestination } = require('./routeurRapports');
const db = require('./database'); 
const { analyserRapport, formaterRapportCoffre } = require('./reportEngine');
const { gererCommandesPatron } = require('./menuPatron');
const { analyserMessage } = require('./analyseur'); // Fix 4 : brancher l'analyseur
const creerGestionnaireManagers = require('./managers'); // Fix 5 : stats managers
let gestionnaireManagers = null; // initialisé au premier message
const cacheOuverture = new Map();

async function getCachePages() {
    if (cacheOuverture.has('pages_kinkole')) return cacheOuverture.get('pages_kinkole');
    // Fallback : cherche dans le dernier rapport d'ouverture du jour en DB
    try {
        const rapports = await db.getReportsAujourdhui('ouverture');
        if (rapports && rapports.length > 0) {
            const pages = rapports[rapports.length - 1]?.contenu?.pages_imprimees;
            if (pages) { cacheOuverture.set('pages_kinkole', pages); return pages; }
        }
    } catch (e) {}
    return 8; // valeur par défaut
}

const GROUPE_SYNCHRO    = '120363021280044937@g.us';
const GROUPE_DISPARUS   = '243900435187-1564716535@g.us';

// Les groupes
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

// =================================================================
// 🧠 ÉTAT D'ATTENTE — gère les conversations en cours dans Synchro
// =================================================================
// Structure : { [groupeJid]: { etape: 'ATTENTE_REPONSE_23H' | 'ATTENTE_FORMAT', managerJid, timestamp } }
const etatAttente = new Map();
const EXPIRATION_ATTENTE_MS = 2 * 60 * 60 * 1000; // 2 heures
const CLE_REDIS_ATTENTE = 'etat_attente_synchro';

// Nettoyage automatique des états expirés en mémoire (toutes les 30 min)
setInterval(() => {
    const maintenant = Date.now();
    for (const [jid, etat] of etatAttente.entries()) {
        if (maintenant - etat.timestamp > EXPIRATION_ATTENTE_MS) {
            etatAttente.delete(jid);
            console.log(`🧹 État d'attente expiré et nettoyé pour : ${jid}`);
        }
    }
}, 30 * 60 * 1000);

// Fix 5 : persistance Redis pour survivre aux redémarrages
// Fix : redis passé directement depuis index.js via setRedisClient()
let redisClient = null;
function setRedisClient(client) { redisClient = client; }

async function sauvegarderEtatAttente() {
    if (!redisClient) return;
    try {
        const data = {};
        for (const [jid, etat] of etatAttente.entries()) data[jid] = etat;
        await redisClient.set(CLE_REDIS_ATTENTE, JSON.stringify(data), 'EX', 7200);
    } catch (e) { console.error('⚠️ Erreur sauvegarde etatAttente Redis:', e.message); }
}

async function chargerEtatAttente() {
    if (!redisClient) return;
    try {
        const raw = await redisClient.get(CLE_REDIS_ATTENTE);
        if (raw) {
            const data = JSON.parse(raw);
            for (const [jid, etat] of Object.entries(data)) {
                if (Date.now() - etat.timestamp < EXPIRATION_ATTENTE_MS) {
                    etatAttente.set(jid, etat);
                }
            }
            console.log(`✅ État d'attente rechargé depuis Redis : ${etatAttente.size} entrée(s)`);
        }
    } catch (e) { console.error('⚠️ Erreur chargement etatAttente Redis:', e.message); }
}

const MODELE_NON_CLOTURE = `📝 *Modèle requis :*\n\nNon clôturé\n421596 = 150000\n1363049 = 75000\n\n_(Un ID et son montant par ligne, séparés par =)_`;

/**
 * Extrait le texte d'un message WhatsApp, peu importe son format
 */
function extraireTexte(msg) {
    const m = msg.message;
    if (!m) return '';
    if (m.ephemeralMessage?.message) return extraireTexte({ message: m.ephemeralMessage.message });
    if (m.viewOnceMessage?.message) return extraireTexte({ message: m.viewOnceMessage.message });
    if (m.viewOnceMessageV2?.message) return extraireTexte({ message: m.viewOnceMessageV2.message });
    if (m.documentWithCaptionMessage?.message?.documentMessage) return m.documentWithCaptionMessage.message.documentMessage.caption || '';
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

/**
 * Parse les incidents au format "ID = Montant" (une paire par ligne)
 * Retourne [] si le format n'est pas respecté sur au moins une ligne valide
 */
function parserIncidentsFormat(texte) {
    const lignes = texte.split('\n').map(l => l.trim()).filter(Boolean);
    const incidents = [];

    // ✅ Format élargi — capture tous les styles réels des managers :
    // "779489 : 372.700fc"  |  "* 779489 : 372.700fc"  |  "• 421596 = 150000"
    // "- 1363049 : 290.450 FC"  |  ". 421556=286350"
    const regexLigne = /^[*\-•.\s]*([0-9]{5,7})\s*[=:]\s*([0-9.,]+)\s*(fc|FC|f|F)?/;

    for (const ligne of lignes) {
        if (/non.{0,10}cl/i.test(ligne)) continue;
        if (/les\s+id/i.test(ligne)) continue;
        if (/ids?\s+non/i.test(ligne)) continue;
        if (/^[-*•=\s]+$/.test(ligne)) continue;
        if (/^[0-9]{1,3}$/.test(ligne)) continue;
        if (/^(aucun|ok|tout|bonsoir|bonjour)/i.test(ligne)) continue;

        const match = ligne.match(regexLigne);
        if (match) {
            const montantBrut = match[2].replace(/\./g, '').replace(',', '.');
            incidents.push({ id: match[1], montant: montantBrut });
        }
    }

    return incidents;
}

/**
 * Vérifie si un texte contient des IDs sans montants (format incorrect)
 */
function contiendIdsSeuls(texte) {
    const lignes = texte.split('\n').map(l => l.trim()).filter(Boolean);
    // ✅ Élargi : détecte "* 779489", "• 421596", "- 1363049", "421596" seul
    const regexIdSeul = /^[*\-•.\s]*[0-9]{5,7}\s*$/;
    return lignes.some(l => regexIdSeul.test(l));
}

/**
 * Traite un rapport de non-clôturé valide (enregistre + publie dans disparus)
 */
async function traiterIncidentsValides(sock, incidents, expediteur, participantJid) {
    const idsEnregistres = [];

    for (const inc of incidents) {
        try {
            await db.sauvegarderIncidentCloture(inc.id, inc.montant, participantJid);
            idsEnregistres.push(inc.id);
        } catch (err) {
            console.error('Erreur DB Incident:', err.message);
        }
    }

    // Marque la journée comme traitée (annule la question de 23h)
    try {
        await db.prisma.report.create({
            data: { type: 'incident_cloture', contenu: { statut: 'INCIDENT_DECLARE' }, managerJid: participantJid }
        });
    } catch (e) {}

    // Message public : IDs seulement, montants cachés
    const phraseIds = idsEnregistres.length > 1
        ? `les ids *${idsEnregistres.join(', ')}* n'ont pas clôturé`
        : `l'id *${idsEnregistres[0]}* n'a pas clôturé`;

    await sock.sendMessage(GROUPE_DISPARUS, {
        text: `⚠️ *RAPPORT MACHINE NON CLÔTURÉE* ⚠️\n\n${phraseIds}`
    });

    // Toi tu reçois avec les montants
    const detail = incidents.map(i => `ID ${i.id} = ${i.montant}`).join('\n');
    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
        text: `⚠️ *NON CLÔTURÉ* déclaré par *${expediteur}*\n\n${detail}\n\n✅ Enregistré en DB. IDs publiés dans Disparus.`
    });

    console.log(`✅ ${idsEnregistres.length} incident(s) traité(s) : ${idsEnregistres.join(', ')}`);
    return idsEnregistres;
}

/**
 * Fonction principale du routeur de messages
 */
async function handleIncomingMessage(sock, { messages, type }, memoire, assistant) {
    if (type !== 'notify') return;

    // Fix 5 : charger l'état depuis Redis au premier message (une seule fois)
    if (!handleIncomingMessage._redisCharge) {
        await chargerEtatAttente();
        handleIncomingMessage._redisCharge = true;
    }

    for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;

        // 📡 LE MOUCHARD : Intercepte TOUS les groupes, même non surveillés !
        if (jid.includes('@g.us')) {
            const texteTest = extraireTexte(msg);
            if (texteTest.toLowerCase().includes('rapport agent') || texteTest.toLowerCase().includes('pénalité')) {
                console.log(`📡 [MOUCHARD GROUPE] JID: ${jid} | Texte: ${texteTest.substring(0, 40)}...`);
            }
        }

        // =========================================================
        // 👑 INTERCEPTEUR : COMMANDES SECRÈTES DU PATRON (EN PRIVÉ)
        // =========================================================
        if (!jid.includes('@g.us')) { 
            const texteBrut = extraireTexte(msg);
            if (texteBrut.startsWith('!')) {
                const commandeTraitee = await gererCommandesPatron(sock, jid, texteBrut);
                if (commandeTraitee) continue;
            }
        }

        // ==========================================
        // 💰 INTERCEPTEUR GLOBAL : RAPPORTS USD (Privé & PR Terrain)
        // ==========================================
        const texteMessage = extraireTexte(msg) || '';
        
        // 🚨 On extrait l'identifiant brut (Numéro ou LID, sans le :15)
        const idBrut = jid.split('@')[0].split(':')[0]; 
        const nomExpediteur = msg.pushName || idBrut;
        
        // 🔑 AJOUT CRITIQUE : On vérifie le Numéro ET le LID !
        const identifiantsAutorises = [
            String(config.monNumero), 
            String(config.secondaireNumero),
            String(config.monLid),         // Ton LID
            String(config.secondaireLid)   // Le LID de Dimercia (138277243904251)
        ];
        
        const estMessagePriveAutorise = !jid.includes('@g.us') && identifiantsAutorises.includes(idBrut);
        const estGroupePRTerrain = (jid === '120363040045715280@g.us');

        // Formule stricte pour attraper 5.660
        const matchUsd = texteMessage.match(/([\d.,]+)\s*\$/);

        if ((estGroupePRTerrain || estMessagePriveAutorise) && matchUsd && texteMessage.toUpperCase().includes('USD')) {
            
            // 🕒 VÉRIFICATION DU CRÉNEAU HORAIRE (Entre 22h00 et 04h59)
            const heureMessage = new Date().getHours();
            const estDansCreneau = (heureMessage >= 22 || heureMessage < 5);

            if (estDansCreneau) {
                // Nettoyage : 5.660 devient 5660
                const texteNettoye = matchUsd[1].replace(/\./g, '').replace(',', '.');
                const montantPropre = parseFloat(texteNettoye);
                
                console.log(`💸 Montant USD détecté (par ${nomExpediteur}) : ${montantPropre}$`);
                
                // Envoi immédiat vers Google Sheets
                const sheet = require('./googleSheets');
                await sheet.enregistrerRecetteUSD(montantPropre);
                
                // Te prévenir sur ton numéro principal
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                    text: `📊 *Google Sheets mis à jour !*\n${montantPropre}$ enregistrés dans le tableau USD (ajouté par *${nomExpediteur}*).` 
                });

                // Si c'est en privé (Dimercia), on lui répond ET on arrête le code
                if (estMessagePriveAutorise) {
                    await sock.sendMessage(jid, { text: `✅ Bien reçu ! La recette de ${montantPropre}$ a été enregistrée avec succès.` });
                    continue; // 👈 BLOQUE L'IA
                }

            } else {
                console.log(`⏳ Montant USD ignoré : détecté à ${heureMessage}h (Hors créneau 22h-5h).`);
                
                if (estMessagePriveAutorise) {
                    await sock.sendMessage(jid, { text: `❌ Enregistrement refusé. Le rapport USD n'est accepté qu'entre 22h00 et 04h59.\nHeure actuelle : ${heureMessage}h.` });
                    continue; // 👈 BLOQUE L'IA
                }
            }
        }
        // 1. TRAITEMENT DES MESSAGES DE GROUPES SURVEILLÉS
        if (jid.includes('@g.us') && config.groupesSurveilles.includes(jid)) {
            await gererMessageGroupe(sock, msg, jid, memoire);
            continue;
        }

        // Fix 17 : intercepter "résolu" dans le groupe Disparus
        if (jid === GROUPE_DISPARUS) {
            const texteBrut = extraireTexte(msg);
            const texteNorm = (texteBrut || '').toLowerCase();
            if (texteNorm.includes('resolu') || texteNorm.includes('résolu')) {
                const idsResolus = texteBrut.match(/\b\d{5,7}\b/g);
                if (idsResolus && idsResolus.length > 0) {
                    for (const machineId of idsResolus) {
                        try { await db.marquerIncidentResolu(machineId); } catch (e) {}
                    }
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                        text: `✅ Résolution capturée depuis Disparus : IDs ${idsResolus.join(', ')} marqués résolus en DB.`
                    });
                }
            }
            continue;
        }

        // 2. TRAITEMENT DES MESSAGES PRIVÉS CLASSIQUES
        if (!jid.includes('@g.us')) {
            await gererMessagePrive(sock, msg, jid, assistant);
        }
    }
}

// ==========================================================
// 🛡️ BOUCLE DE SÉCURITÉ : RATTRAPAGE AUTOMATIQUE (PRISMA)
// ==========================================================
async function lancerRattrapageAutomatique(sock, db) {
    setInterval(async () => {
        console.log("🔄 Scan de sécurité : Vérification des rapports en attente...");
        try {
            const messagesRata = await db.getMessagesNonTraites();
            if (!messagesRata || messagesRata.length === 0) return;

            console.log(`⚠️ ALERTE : ${messagesRata.length} rapport(s) ignoré(s) détecté(s). Rattrapage en cours...`);

            for (const msg of messagesRata) {
                if (!msg.texte) continue;
                
                const { analyserRapport } = require('./reportEngine'); 
                const analyse = analyserRapport(msg.texte);
                const typeLocal = analyse.type;

                if (typeLocal !== 'inconnu') {
                    try {
                        await db.sauvegarderReport(typeLocal, analyse.donnees || {}, msg.senderJid, true, null);
                    } catch (e) {}

                    if (typeLocal === 'ouverture') {
                        await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: msg.texte });
                        const demandeFixture = `✅ Ouverture validée (Rattrapage automatique).\n\nIl me manque les informations :\n• Taux d'achat USD\n• Taux de vente USD\n• Loto\n• Giga\n• Félicitations\n\n📝 *Modèle à utiliser :*\nTaux de change\nAchat: \nVente: \nLoto: \nGiga: \nFélicitation: `;
                        await sock.sendMessage(GROUPE_SYNCHRO, { text: demandeFixture });
                    }
                    else if (typeLocal === 'fixture') {
                        const d = analyse.donnees || {};
                        const pages = 8;
                        const copiesParAgent = 2;
                        const totalParAgent = (pages * copiesParAgent) + (d.loto || 0) + (d.giga || 0) + (d.felicitation || 0);
                        const rapportFixtureFinal = `*Fixtures sport betting kinkole shop*\nNb. Pages: ${pages}\nNb.Copies par agent: ${copiesParAgent}\nFixture (other)\nloto: ${d.loto || 0}\nGiga: ${d.giga || 0}\nFélicitation : ${d.felicitation || 0}\nTotal/agt: ${totalParAgent}\n----------------\nTaux de change\nAchat: ${d.taux_achat || '?'}\nVente: ${d.taux_vente || '?'}`;
                        await sock.sendMessage(config.groupesDestination.rate_fixture.id, { text: rapportFixtureFinal });
                    }
                    else if (typeLocal === 'fermeture' || typeLocal === 'details_connexion') {
                        await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: msg.texte });
                    }
                }
                await db.marquerMessageTraite(msg.id);
            }
            console.log("✅ Rattrapage de sécurité terminé avec succès !");
        } catch (err) {
            console.error("❌ Erreur pendant le rattrapage de sécurité :", err);
        }
    }, 15 * 60 * 1000); 
}

/**
 * Gère la logique des messages reçus dans les groupes
 */
async function gererMessageGroupe(sock, msg, jid, memoire) {
    const participantJid = msg.key.participant || msg.key.remoteJid || '';
    
    // ==========================================
    // 🛡️ LE VIGILE HYBRIDE (FILTRE DE SÉCURITÉ)
    // ==========================================
    const MANAGERS_AUTORISES = [
        '42967356150013@lid',  // Timothé Le Noir
        '265515029283001@lid', // Deborah Kavunga
        '90263603159168@lid',  // Trésor bk
        '169230989307948@lid'  // Erick kenzo (Eric pos man)
    ];
    const estManagerAutorise = MANAGERS_AUTORISES.includes(participantJid);

    const estPatron = (
        participantJid.includes(config.monNumero) || 
        participantJid.includes(config.secondaireNumero) || 
        participantJid === config.monLid || 
        participantJid === config.secondaireLid ||
        participantJid === '204685424214253@lid'
    );

    // 👇 LA LIGNE MANQUANTE À REMETTRE ICI :
    const estDansSynchro = (jid === GROUPE_SYNCHRO);

    // 🟢 On définit les groupes "Ouverts" où les agents de terrain ont le droit de parler
    const estGroupeOuvert = (
        estDansSynchro || 
        jid === '120363040045715280@g.us' ||      // Rapport PR terrain
        jid === '243900435187-1578719495@g.us' || // Agent Visité
        jid === '243907634105-1540987363@g.us'    // Pénalités
    );

    if (!estGroupeOuvert && !estManagerAutorise && !estPatron) {
        return; // Le vigile bloque
    }

    const expediteur = msg.pushName || participantJid.split('@')[0] || 'Inconnu';
    const texteBrut = extraireTexte(msg);

    const estMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage || msg.message?.documentWithCaptionMessage);
    const texteStocke = estMedia && !texteBrut ? '[Média sans légende]' : texteBrut;

    if (!texteBrut) return; 

    const texteNormalise = texteBrut.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    console.log(`📌 EXPEDITEUR | JID: ${participantJid} | Nom: ${expediteur} | Texte: ${texteNormalise.substring(0, 50)}...`);

    // Fix 4 : analyser le message AVANT de sauvegarder pour enrichir avec catégorie/priorité
    const messageBase = {
        groupeJid: jid, groupeNom: NOMS_GROUPES[jid] || jid,
        expediteurJid: participantJid, expediteur,
        texte: texteStocke, estMedia, timestamp: Date.now()
    };
    const messageAnalyse = analyserMessage(messageBase);

    // ==========================================
    // 🛑 FILTRE ANTI-POLLUTION (REDIS + DB + STATS)
    // ==========================================
    const estGroupeVisiteAllShop = (jid === '243900435187-1578719495@g.us');
    const estGroupePenaliteAllShop = (jid === '243907634105-1540987363@g.us');
    
    let doitSauvegarder = true;

    // Si le message vient de ces deux groupes précis, on exige "Kinkole"
    if (estGroupeVisiteAllShop || estGroupePenaliteAllShop) {
        if (!texteNormalise.includes('kinkole') && !texteNormalise.includes('kinko')) {
            doitSauvegarder = false; // On bloque TOUT pour Mateté, DGC, etc.
        }
    }

    let messageDbId = null;

    if (doitSauvegarder) {
        // 1. Sauvegarde en mémoire Redis (IA)
        await memoire.sauvegarderMessage(jid, messageAnalyse);

        // 2. Sauvegarde dans PostgreSQL conditionnelle
        try {
            await db.upsertManager(participantJid, expediteur);
            const savedMsg = await db.sauvegarderMessage(jid, participantJid, texteStocke, estMedia);
            if (savedMsg && savedMsg.id) messageDbId = savedMsg.id;
        } catch (e) {
            console.error('⚠️ Erreur DB Sauvegarde Brute:', e.message);
        }
        
        // 3. Enregistrer activité manager avec catégorie (Statistiques)
        if (!gestionnaireManagers) gestionnaireManagers = creerGestionnaireManagers(redisClient);
        await gestionnaireManagers.enregistrerActivite(participantJid, messageAnalyse);
        
    } else {
        console.log(`🚫 [FILTRE GLOBAL] Message de ${expediteur} ignoré (Hors Kinkole).`);
    }

    const heureActuelle = new Date().getHours();

    
    // =================================================================
    // 🗼 INTERCEPTEUR GLOBAL DE CLÔTURE — UNIQUEMENT DANS SYNCHRO
    // =================================================================
    if (estDansSynchro) {

        // ⛔ Rapports légitimes qui contiennent des IDs+montants mais ne sont PAS des non-clôturés
        const estRapportAutre = (
            texteNormalise.includes('reste caution') ||
            texteNormalise.includes('rapport reste') ||
            texteNormalise.includes('instant win') ||
            texteNormalise.includes('number games') ||
            texteNormalise.includes('ids plus') ||
            texteNormalise.includes('ids moins') ||
            texteNormalise.includes('fixture') ||
            texteNormalise.includes('dernier rapport') ||
            texteNormalise.includes('dernier ticket') ||
            texteNormalise.includes('nombre de tickets') ||
            texteNormalise.includes('etat des stocks') ||
            texteNormalise.includes('état des stocks') ||
            // "ticket" seul mais PAS si accompagné de "non clôturé"
            (texteNormalise.includes('ticket') && !texteNormalise.includes('non cl') && !texteNormalise.includes('cloture'))
        );

        const estNonCloture = !estRapportAutre && (
            // Formulations directes
            texteNormalise.includes('non cloture') || 
            texteNormalise.includes('non clôture') || 
            texteNormalise.includes('non cloturer') ||
            texteNormalise.includes('non clôturer') ||
            texteNormalise.includes('pas cloture') || 
            texteNormalise.includes('pas clôturé') || 
            texteNormalise.includes('pas cloturer') ||
            texteNormalise.includes('n a pas cloture') ||
            texteNormalise.includes("n'a pas cloture") ||
            texteNormalise.includes('n ont pas cloture') ||
            // Formulations avec "ids"
            texteNormalise.includes('ids non') ||
            texteNormalise.includes('id non') ||
            texteNormalise.includes('les id non') ||
            texteNormalise.includes('les ids non') ||
            texteNormalise.includes('ids non cloture') ||
            // Formulations de Timothée et autres managers
            texteNormalise.includes('les ids non cloture') ||
            texteNormalise.includes('les ids non clôturé') ||
            // Mot clé seul suffit si suivi d'IDs
            (texteNormalise.includes('cloture') && /[0-9]{5,7}/.test(texteNormalise))
        );

        const estResolution = texteNormalise.includes('resolu') || texteNormalise.includes('résolu');

        const estBilanOk = texteNormalise === 'oui' || 
                           texteNormalise.includes('tout est ok') || 
                           texteNormalise.includes('cloture ok') || 
                           texteNormalise.includes('clôture normale') || 
                           texteNormalise.includes('tout le monde a cloture') ||
                           texteNormalise.includes('rien a signaler');

        // ─────────────────────────────────────────────────────────
        // 🔵 CAS 0 : ON EST EN ATTENTE D'UNE RÉPONSE (état actif)
        // ─────────────────────────────────────────────────────────
        const attente = etatAttente.get(jid);
        if (attente) {

            // ÉTAPE A : On attendait "oui/non/IDs" après la question de 23h
            if (attente.etape === 'ATTENTE_REPONSE_23H') {

                if (estBilanOk) {
                    // ✅ Tout est ok → on ferme la journée
                    try {
                        await db.prisma.report.create({
                            data: { type: 'incident_cloture', contenu: { statut: 'TOUT_EST_OK' }, managerJid: participantJid }
                        });
                    } catch (e) {}
                    etatAttente.delete(jid);
                    await sock.sendMessage(jid, { text: `✅ Parfait, merci *${expediteur}*. Bonne fin de journée à toute l'équipe !` });
                    return;
                }

                if (estNonCloture || (!estRapportAutre && contiendIdsSeuls(texteBrut))) {
                    // Le manager signale des non-clôturés → vérifier le format
                    const incidents = parserIncidentsFormat(texteBrut);

                    if (incidents.length > 0) {
                        // ✅ Format correct
                        etatAttente.delete(jid);
                        await traiterIncidentsValides(sock, incidents, expediteur, participantJid);
                    } else {
                        // ❌ Format incorrect → demander la correction
                        etatAttente.set(jid, { etape: 'ATTENTE_FORMAT', timestamp: Date.now() });
                        await sauvegarderEtatAttente();
                        await sock.sendMessage(jid, {
                            text: `⚠️ Format incorrect. Je ne peux pas enregistrer sans les montants.\n\n${MODELE_NON_CLOTURE}`
                        });
                    }
                    return;
                }

                // Réponse non reconnue
                await sock.sendMessage(jid, {
                    text: `❓ Je n'ai pas compris. Répondez :\n• *"Tout est ok"* si tout le monde a clôturé\n• Ou envoyez la liste des IDs non clôturés avec le modèle ci-dessous\n\n${MODELE_NON_CLOTURE}`
                });
                return;
            }

            // ÉTAPE B : On attendait la correction du format
            if (attente.etape === 'ATTENTE_FORMAT') {
                const incidents = parserIncidentsFormat(texteBrut);

                if (incidents.length > 0) {
                    // ✅ Format corrigé
                    etatAttente.delete(jid);
                    await traiterIncidentsValides(sock, incidents, expediteur, participantJid);
                } else {
                    // ❌ Toujours incorrect
                    await sock.sendMessage(jid, {
                        text: `⚠️ Format encore incorrect. Merci de respecter exactement le modèle :\n\n${MODELE_NON_CLOTURE}`
                    });
                }
                return;
            }
        }

        // ─────────────────────────────────────────────────────────
        // 🔴 CAS A : NON-CLÔTURÉ ENVOYÉ EN ANTICIPATION (avant 23h)
        // ─────────────────────────────────────────────────────────
        if (estNonCloture || (!estRapportAutre && heureActuelle >= 22 && contiendIdsSeuls(texteBrut))) {
            const incidents = parserIncidentsFormat(texteBrut);

            if (incidents.length > 0) {
                // ✅ Format correct → traitement immédiat
                await traiterIncidentsValides(sock, incidents, expediteur, participantJid);
            } else {
                // ❌ Format incorrect → on demande la correction et on attend
                etatAttente.set(jid, { etape: 'ATTENTE_FORMAT', timestamp: Date.now() });
                await sauvegarderEtatAttente();
                await sock.sendMessage(jid, {
                    text: `⚠️ J'ai bien capté le rapport de non-clôturé, mais le format est incorrect.\n\nJe ne peux pas enregistrer et publier sans les montants.\n\n${MODELE_NON_CLOTURE}`
                });
            }
            return;
        }

        // ─────────────────────────────────────────────────────────
        // 🟢 CAS B : RÉSOLUTION D'UN INCIDENT
        // ─────────────────────────────────────────────────────────
        if (estResolution) {
            const idsResolus = texteBrut.match(/\b\d{5,7}\b/g);
            
            if (idsResolus && idsResolus.length > 0) {
                for (const machineId of idsResolus) {
                    try { await db.marquerIncidentResolu(machineId); } catch (err) {}
                }
                
                const phraseResolution = idsResolus.length > 1 
                    ? `les ids ${idsResolus.join(', ')} — problème résolu ✅` 
                    : `l'id ${idsResolus[0]} — problème résolu ✅`;

                await sock.sendMessage(GROUPE_DISPARUS, { text: `✅ Mise à jour : ${phraseResolution}` });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: `✅ Incident(s) clos en DB : ${idsResolus.join(', ')}` });
                return;
            }
        }

        // ─────────────────────────────────────────────────────────
        // 🔵 CAS C : TOUT EST OK (sans état d'attente actif)
        // ─────────────────────────────────────────────────────────
        if (estBilanOk) {
            try {
                await db.prisma.report.create({
                    data: { type: 'incident_cloture', contenu: { statut: 'TOUT_EST_OK' }, managerJid: participantJid }
                });
            } catch (e) {}
            await sock.sendMessage(jid, { text: `✅ Merci *${expediteur}*, bonne fin de journée !` });
            return;
        }
    }


    // =================================================================
    // 🕵️‍♂️ INTERCEPTEUR TERRAIN ET PÉNALITÉS (WORKFLOWS SPÉCIFIQUES)
    // =================================================================
    
    // 1️⃣ GROUPE : Rapport PR terrain kinko
    if (jid === '120363040045715280@g.us') {
        
        // (L'extraction USD est maintenant gérée plus haut par l'intercepteur global)

        // 🛑 On bloque le boss/secondaire pour la suite du workflow
        if (estPatron) return; 

        // 🛑 On vérifie que c'est un vrai rapport d'agent avant de transférer
        if (!texteNormalise.includes('p.d.v') && !texteNormalise.includes('pdv') && !texteNormalise.includes('ticket')) {
            console.log(`⚠️ Message ignoré (hors sujet) : ${texteStocke.substring(0, 20)}...`);
            return; 
        }
        
        // ✅ C'est un vrai rapport de visite, on sauvegarde
        await db.sauvegarderVisiteTerrain(participantJid, texteStocke, 'Rapport PR');
        await sock.sendMessage('243900435187-1578719495@g.us', { text: texteStocke });
        return;
    }
    
    // 2️⃣ GROUPE : Agent en ordre & Visité
    if (jid === '243900435187-1578719495@g.us') { 
        if (estPatron) return; 
        
        if (texteNormalise.includes('kinkole') || texteNormalise.includes('kinko')) {
            await db.sauvegarderVisiteTerrain(participantJid, texteStocke, 'Agent Visité');
        }
        return;
    }

    // 3️⃣ GROUPE : PENALITy QS all shop
    if (jid === '243907634105-1540987363@g.us') {
        if (texteNormalise.includes('kinkole') || texteNormalise.includes('kinko')) {
            await db.sauvegarderPenalite(participantJid, texteStocke);
        }
        return;
    }
    // =================================================================

    // ── DÉTECTION DES AUTRES RAPPORTS STANDARDS (OUVERTURE, FIXTURE...) ──
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
        texteNormalise.includes('etat d activites') ||
        texteNormalise.includes('etat materiel') ||
        texteNormalise.includes('taux de change') ||
        texteNormalise.includes('taux') ||
        texteNormalise.includes('achat')
    );

    if (estProbablementRapport) {
        const analyseLocale = analyserRapport(texteBrut); 
        let typeLocal = analyseLocale.type;
        let iaType = "Non consultée";
        
        if (typeLocal === 'inconnu') {
            try {
                const detection = await detecterTypeRapport(texteBrut);
                iaType = detection.type || 'inconnu';
                typeLocal = iaType;
            } catch (e) {
                console.log("⚠️ Appel IA ignoré (API indisponible)");
            }
        }
        
        console.log(`🔍 Local: ${analyseLocale.type} | IA: ${iaType} | Final: ${typeLocal}`);

        if (typeLocal !== 'inconnu') {
            const manager = config.managers[participantJid] || { nom: expediteur };

            try {
                await db.sauvegarderReport(typeLocal, analyseLocale.donnees || {}, participantJid, true, null);
                console.log(`✅ Rapport structuré (${typeLocal}) sauvegardé dans la base !`);
                
                // 🛑 CORRECTION ANTI-DOUBLONS : On utilise le VRAI ID de la base de données
                if (messageDbId) {
                    await db.marquerMessageTraite(messageDbId);
                }
            } catch (e) {
                console.error('⚠️ Erreur DB (Sauvegarde ou Marquage traité):', e.message);
            }


            // ⚙️ WORKFLOW 1 : OUVERTURE
            if (typeLocal === 'ouverture') {
                const pages = analyseLocale.donnees?.pages_imprimees;
                cacheOuverture.set('pages_kinkole', pages || 8);

                // Anti-doublon : ne pas renvoyer si déjà routé aujourd'hui
                const ouverturesDuJour = await db.getReportsAujourdhui('ouverture');
                if (ouverturesDuJour && ouverturesDuJour.length > 1) {
                    console.log(`⚠️ Ouverture déjà routée aujourd'hui — envoi ignoré.`);
                    return;
                }

                await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: texteBrut });

                // Fix 14 : avertir si pages manquantes
                if (!pages) {
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                        text: `⚠️ Ouverture reçue de *${expediteur}* mais le nombre de pages est absent.\n\nFixture calculée sur 8 pages par défaut.`
                    });
                }

                // Ne demander les taux que si pas encore reçus aujourd'hui
                if (heureActuelle < 10) {
                    const fixturesDuJour = await db.getReportsAujourdhui('fixture');
                    if (!fixturesDuJour || fixturesDuJour.length === 0) {
                        const demandeFixture = `✅ Ouverture validée.\n\nIl me manque les informations suivantes pour calculer les fixtures :\n• Taux d'achat USD\n• Taux de vente USD\n• Loto\n• Giga\n• Félicitations\n\n📝 *Modèle à utiliser :*\nTaux de change\nAchat: \nVente: \nLoto: \nGiga: \nFélicitation: `;
                        await sock.sendMessage(GROUPE_SYNCHRO, { text: demandeFixture });
                    }
                }
                return;
            }

            // ⚙️ WORKFLOW 2 : CALCUL DES FIXTURES
            else if (typeLocal === 'fixture') {
                // Anti-doublon : ne pas recalculer si déjà routé aujourd'hui
                const fixturesDuJour = await db.getReportsAujourdhui('fixture');
                if (fixturesDuJour && fixturesDuJour.length > 1) {
                    console.log(`⚠️ Fixture déjà routée aujourd'hui — envoi ignoré.`);
                    return;
                }

                const d = analyseLocale.donnees || {};
                const pages = await getCachePages();
                const copiesParAgent = 2;
                const loto = d.loto || 0;
                const giga = d.giga || 0;
                const felicitation = d.felicitation || 0;
                const totalParAgent = (pages * copiesParAgent) + loto + giga + felicitation;

                const rapportFixtureFinal = `*Fixtures sport betting kinkole shop*\n` +
                                            `Nb. Pages: ${pages}\n` +
                                            `Nb.Copies par agent: ${copiesParAgent}\n` +
                                            `Fixture (other)\n` +
                                            `loto: ${loto}\n` +
                                            `Giga: ${giga}\n` +
                                            `Félicitation : ${felicitation}\n` +
                                            `Total/agt: ${totalParAgent}\n` +
                                            `----------------\n` +
                                            `Taux de change\n` +
                                            `Achat: ${d.taux_achat || '?'}\n` +
                                            `Vente: ${d.taux_vente || '?'}`;

                await sock.sendMessage(config.groupesDestination.rate_fixture.id, { text: rapportFixtureFinal });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: `✅ Fixture publiée par *${expediteur}*.` });
                return;
            }

            // ⚙️ WORKFLOW 3 : FERMETURE
            else if (typeLocal === 'fermeture') {
                const fermeturesDuJour = await db.getReportsAujourdhui('fermeture');
                if (fermeturesDuJour && fermeturesDuJour.length > 1) {
                    console.log(`⚠️ Fermeture déjà routée aujourd'hui — envoi ignoré.`);
                    return;
                }
                await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: texteBrut });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                    text: `✅ *DERNIER RAPPORT* de *${expediteur}* transféré dans *Gestion Center*.` 
                });
                return;
            }

            // ⚙️ WORKFLOW 4 : DÉTAILS CONNEXION
            else if (typeLocal === 'details_connexion') {
                await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: texteBrut });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                    text: `✅ *DÉTAILS CONNEXION* de *${expediteur}* transféré dans *Gestion Center*.` 
                });
                return;
            }

            // ⚙️ WORKFLOW CLASSIQUE
            else {
                const destination = getDestination(typeLocal);
                const groupeDest = destination ? config.groupesDestination[destination] : null;

                if (groupeDest) {
                    const completude = await verifierCompletude(texteBrut, typeLocal);
                    
                    if (completude.complet) {
                        await sock.sendMessage(groupeDest.id, { text: texteBrut });
                        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                            text: `✅ *${typeLocal.toUpperCase()}* de *${manager.nom}* → *${groupeDest.nom}*`
                        });
                    } else {
                        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                            text: `⚠️ *${typeLocal.toUpperCase()}* de *${manager.nom}* incomplet.\n\n` +
                                  `❌ Manquants :\n${completude.manquants.map(m => `• ${m}`).join('\n')}\n\n` +
                                  `📍 Reçu dans : *${NOMS_GROUPES[jid] || jid}*`
                        });
                    }
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

    if (texte.toLowerCase().includes('coffre')) {
        console.log('🔒 Rapport de coffre brut reçu du patron, formatage en cours...');
        try {
            const rapportFormate = formaterRapportCoffre(texte);
            await sock.sendMessage(config.groupesDestination.s_check.id, { text: rapportFormate });
            await db.sauvegarderReport('coffre', { texte: texte }, jid, true, null);
            await sock.sendMessage(jid, { text: `✅ Rapport formaté et publié avec succès dans *S Check* !` });
            return; 
        } catch (error) {
            console.error("❌ Erreur lors du formatage du coffre :", error);
            await sock.sendMessage(jid, { text: `⚠️ Erreur lors du traitement de ton rapport de coffre.` });
            return;
        }
    }

    if (texte.trim().toUpperCase() === 'PING') {
        await sock.sendMessage(jid, { text: 'PONG ✅' });
        return;
    }

    await sock.readMessages([msg.key]);
    await sock.sendPresenceUpdate('composing', jid);

    const cmd = texte.trim().toUpperCase();
    if (['MENU', 'START', '0', 'BONJOUR', 'HI', 'ANNULER', 'CANCEL', 'STOP', 'OUI', 'NON'].includes(cmd) ||
        ['1','2','3','4','5'].includes(cmd)) {
        await traiterMessage(sock, jid, texte);
        return;
    }

    const traitePar = await assistant.traiterCommande(texte, jid);
    if (!traitePar) {
        await traiterMessage(sock, jid, texte);
    }
}

// Export de etatAttente pour que tourDeControle.js puisse activer l'état d'attente
module.exports = {
    handleIncomingMessage,
    gererMessageGroupe,
    lancerRattrapageAutomatique,
    etatAttente,      // ← tourDeControle l'utilise pour déclencher ATTENTE_REPONSE_23H
    setRedisClient    // ← appelé depuis index.js pour passer le client Redis
};
