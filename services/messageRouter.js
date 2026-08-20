const config = require('../config');
const traiterMessage = require('./reportService');
const { detecterTypeRapport, verifierCompletude, getDestination } = require('./routeurRapports');
const db = require('./database'); 
const { analyserRapport, formaterRapportCoffre } = require('./reportEngine');
const { gererCommandesPatron } = require('./menuPatron');
const { analyserMessage } = require('./analyseur'); // Fix 4 : brancher l'analyseur
const { agentDialogueManager } = require('./agents'); // 👁️ Import du cerveau pour l'Oeil de Lynx
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

const GROUPE_SYNCHRO    = '243906226846-1565006518@g.us';
const GROUPE_DISPARUS   = '243900435187-1564716535@g.us';

// Les groupes
const NOMS_GROUPES = {
    '243906226846-1565006518@g.us': 'Synchro Kingasani',
    '120363023010071105@g.us': 'Synchro Kinkole pos',
    '120363025487823123@g.us': 'Winner Shop kinkole',
    '120363409129431148@g.us': 'Rapport PR terrain kinko',
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
const cooldownRelance = new Map();
const derniereDemande = new Map();
const MANAGERS_APPROBATION = {
    '138277243904251@lid': 'Boss Secondaire',
    '51583027036329@lid':  'Vero',
    '55456802304094@lid':  'Guy',
    '104883655057593@lid': 'Josias',
    '155023019364375@lid': 'Blaise'
};
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
 * Parse les incidents au format "ID = Montant" ou "ID Statut" (Matin)
 * Capture tous les styles (* 779489 : 372.700fc | • 421596 = 150000 | 1134912 résolu)
 */
function parserIncidentsFormat(texte) {
    const texteSecurise = (texte || '').toLowerCase();

    // 🛑 BARRIÈRE DE SÉCURITÉ ABSOLUE : Ignore les rapports de connexion
    if (texteSecurise.includes('ids connecté') || 
        texteSecurise.includes('plus des ticket') || 
        texteSecurise.includes('moins 20 ticket') || 
        texteSecurise.includes('instant win') ||
        texteSecurise.includes('connexion 12h') ||
        texteSecurise.includes('connexion 15h') ||
        texteSecurise.includes('connexion 17h')) {
        return [];
    }

    // Barrière annulation/demande
    if (texteSecurise.includes('annulation') || 
        texteSecurise.includes('versement') ||
        texteSecurise.includes('demande t-shirt') ||
        texteSecurise.includes('demande tshirt') ||
        texteSecurise.includes('achat carburant') ||
        texteSecurise.includes('présent au shop')) {
        return [];
    }

    const lignes = texte.split('\n').map(l => l.trim()).filter(Boolean);
    const incidents = [];

    // ✅ NOUVEAU REGEX HYBRIDE : 
    // - Capture l'ID : ([0-9]{5,7})
    // - Accepte comme séparateur : = ou : ou même un simple espace \s*[=: ]\s*
    // - Capture tout le reste de la ligne (montant + FC ou mot "résolu") : (.+)
    const regexLigne = /^[*\-•.\s]*(?:id|🆔)?[\s.:\-*]*([0-9]{5,7})[\s=:\-*]*(.+)$/i;
    
    for (const ligne of lignes) {
        if (/non.{0,10}cl/i.test(ligne) || /les\s+id/i.test(ligne) || /ids?\s+non/i.test(ligne)) continue;
        if (/^[-*•=\s]+$/.test(ligne) || /^[0-9]{1,3}$/.test(ligne) || /^(aucun|ok|tout|bonsoir|bonjour)/i.test(ligne)) continue;

        const match = ligne.match(regexLigne);
        if (match) {
            const idMachine = match[1];
            let valeurBrute = match[2].trim().toLowerCase(); // Ex: "372.700fc" ou "résolu"

            // ☀️ 1. CAS DU MATIN (Suivi de résolution)
            if (valeurBrute.includes('non') || valeurBrute.includes('persiste')) {
                incidents.push({ id: idMachine, montant: 'NON_RESOLU', type: 'suivi' });
            } 
            else if (valeurBrute.includes('resolu') || valeurBrute.includes('résolu') || valeurBrute.includes('réglé') || valeurBrute.includes('regle')) {
                incidents.push({ id: idMachine, montant: 'RESOLU', type: 'suivi' });
            } 
            // 🌙 2. CAS DU SOIR (Rapport financier : "372.700fc")
            else {
                // Nettoyage radical : Enlève tout ce qui n'est PAS un chiffre, un point ou une virgule
                // Ça supprime automatiquement les "fc", "f", "FC" et les espaces !
                const montantNettoye = valeurBrute.replace(/[^\d.,]/g, '');
                
                // On transforme 372.700 en 372700
                const montantFinal = montantNettoye.replace(/\./g, '').replace(',', '.');
                
                if (!isNaN(montantFinal) && montantFinal.length > 0) {
                    incidents.push({ id: idMachine, montant: montantFinal, type: 'argent' });
                }
            }
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
 * Extrait les IDs résolus d'un texte spontané ligne par ligne.
 * Ignore totalement les IDs situés sur une ligne contenant "non", "pas" ou "persiste".
 */
function extraireIdsResolusSecurise(texte) {
    const ids = [];
    const lignes = (texte || '').split('\n'); // Découpe le message ligne par ligne
    
    for (let ligne of lignes) {
        const ligneNorm = ligne.toLowerCase();
        
        // La ligne contient-elle une victoire ?
        const contientResolu = ligneNorm.includes('resolu') || ligneNorm.includes('résolu') || ligneNorm.includes('regle') || ligneNorm.includes('réglé');
        
        // La ligne contient-elle une négation ?
        const contientNegation = ligneNorm.includes('non') || ligneNorm.includes('pas') || ligneNorm.includes('persiste');
        
        // Si c'est résolu ET qu'il n'y a aucune négation sur la ligne
        if (contientResolu && !contientNegation) {
            const matchs = ligne.match(/\b\d{5,7}\b/g); // On attrape les IDs de 5 à 7 chiffres
            if (matchs) ids.push(...matchs);
        }
    }
    return [...new Set(ids)]; // Enlève les doublons
}

async function traiterIncidentsValides(sock, incidents, expediteur, participantJid, assistant) {
    const idsNouveaux = [];
    const incidentsNouveauxDetails = [];
    
    const idsResolus = [];
    const idsNonResolus = [];

    // 1. On trie les informations reçues
    for (const inc of incidents) {
        try {
            if (inc.type === 'suivi') {
                if (inc.montant === 'RESOLU') {
                    await db.marquerIncidentResolu(inc.id);
                    if (assistant?.notifierResolution) {
                        await assistant.notifierResolution(inc.id, participantJid, expediteur);
                    }
                    idsResolus.push(inc.id);
                } else {
                    // Si le manager a écrit "non résolu"
                    idsNonResolus.push(inc.id);
                }
            } else {
                // C'est un NOUVEL incident d'aujourd'hui (avec un montant financier)
                await db.sauvegarderIncidentCloture(inc.id, inc.montant, participantJid);
                if (assistant?.notifierIncident) {
                    await assistant.notifierIncident(inc.id, participantJid, expediteur);
                }
                idsNouveaux.push(inc.id);
                incidentsNouveauxDetails.push(`ID ${inc.id} = ${inc.montant}`);
            }
        } catch (err) {
            console.error('Erreur DB Incident:', err.message);
        }
    }

    // =====================================
    // 🟢 SCÉNARIO 1 : L'INCIDENT EST RÉSOLU
    // =====================================
    if (idsResolus.length > 0) {
        const phraseResolution = idsResolus.length > 1 
            ? `Les IDs *${idsResolus.join(', ')}* — problème résolu ✅` 
            : `L'ID *${idsResolus[0]}* — problème résolu ✅`;
        
        // 📢 On publie la bonne nouvelle dans le groupe !
        await sock.sendMessage(GROUPE_DISPARUS, { text: `✅ *MISE À JOUR :*\n${phraseResolution}` });
        
        // Notification silencieuse pour toi
        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
            text: `✅ Suivi : Incident(s) clos en DB : ${idsResolus.join(', ')} (par ${expediteur})` 
        });
    }

    // =====================================
    // 🔴 SCÉNARIO 2 : LE RELIQUAT N'EST TOUJOURS PAS RÉGLÉ
    // =====================================
    if (idsNonResolus.length > 0) {
        // 🤫 Le bot reste SILENCIEUX dans les groupes.
        
        // 📩 Mais il envoie un conseil de management en privé au manager :
        const msgConseil = `⚠️ *CONSEIL DE SUIVI* ⚠️\n\nCher manager, vous avez signalé que le problème de non-clôturé (reliquat) pour les IDs *${idsNonResolus.join(', ')}* n'est toujours pas réglé.\n\n👉 *Veuillez suivre ce dossier de très près auprès de l'agent concerné afin que la situation soit régularisée le plus vite possible.*\n\nBon courage à vous !`;
        
        await sock.sendMessage(participantJid, { text: msgConseil });

        // Notification silencieuse pour toi
        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
            text: `❌ Suivi : Le non-clôturé persiste pour les IDs : ${idsNonResolus.join(', ')} (déclaré par ${expediteur}). Le bot a rappelé au manager de suivre le dossier.` 
        });
    }

    // =====================================
    // 🟠 SCÉNARIO 3 : NOUVEAUX INCIDENTS DU JOUR
    // =====================================
    if (idsNouveaux.length > 0) {
        try {
            await db.prisma.report.create({
                data: { type: 'incident_cloture', contenu: { statut: 'INCIDENT_DECLARE' }, managerJid: participantJid }
            });
        } catch (e) {}

        const phraseIds = idsNouveaux.length > 1 
            ? `les ids *${idsNouveaux.join(', ')}* n'ont pas clôturé` 
            : `l'id *${idsNouveaux[0]}* n'a pas clôturé`;
        
        // 📢 On publie l'alerte du nouveau problème
        await sock.sendMessage(GROUPE_DISPARUS, { text: `⚠️ *RAPPORT MACHINE NON CLÔTURÉE* ⚠️\n\n${phraseIds}` });

        const detail = incidentsNouveauxDetails.join('\n');
        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
            text: `⚠️ *NOUVEAU NON CLÔTURÉ* déclaré par *${expediteur}*\n\n${detail}\n\n✅ Enregistré en DB.`
        });
    }

    return idsNouveaux;
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

        // 🕵️‍♂️ OUTIL TEMPORAIRE POUR RÉCUPÉRER LES IDs
        const texteOutil = extraireTexte(msg);
        if (texteOutil && texteOutil.trim() === '!id') {
            const exp = msg.key.participant || jid;
            const reponseID = `🟢 *SCAN RÉUSSI* 🟢\n\n🏢 *ID du Groupe :*\n${jid}\n\n👤 *Ton ID personnel :*\n${exp}`;
            await sock.sendMessage(jid, { text: reponseID });
            continue; // Stoppe le reste pour éviter de polluer la base de données
        }

        // 📡 LE MOUCHARD : Intercepte TOUS les groupes, même non surveillés !
        if (jid.includes('@g.us')) {
            const texteTest = extraireTexte(msg);
            if (texteTest.toLowerCase().includes('rapport agent') || texteTest.toLowerCase().includes('pénalité')) {
                console.log(`📡 [MOUCHARD GROUPE] JID: ${jid} | Texte: ${texteTest.substring(0, 40)}...`);
            }
        }

        // =========================================================
        // 👑 INTERCEPTEUR : COMMANDES SECRÈTES ET LANGAGE NATUREL
        // =========================================================
        if (!jid.includes('@g.us')) { 
            const texteBrut = extraireTexte(msg);
            
            // 1. Exécution rapide si tu utilises la commande stricte (ex: !semaine)
            if (texteBrut.startsWith('!')) {
                const commandeTraitee = await gererCommandesPatron(sock, jid, texteBrut);
                if (commandeTraitee) continue;
            }
            // 2. La Magie du Langage Naturel (Si tu lui parles normalement)
            else {
                const idBrut = jid.split('@')[0].split(':')[0]; 
                const identifiantsAutorises = [String(config.monNumero), String(config.secondaireNumero), String(config.monLid), String(config.secondaireLid)];
                
                // On ne déclenche l'analyse que si c'est le Boss et que la phrase fait plus de 10 caractères
                const texteMinusculeCheck = texteBrut.toLowerCase();
                    if (identifiantsAutorises.includes(idBrut) && texteBrut.length > 10 && !texteMinusculeCheck.includes('coffre')) {
                    
                    // On fait appel au routeur d'intentions de l'IA
                    const { agentIntention } = require('./agents');
                    const analyse = await agentIntention(texteBrut, []);
                    
                    let commandeSecrete = null;
                    const texteMinuscule = texteBrut.toLowerCase();

                    // 🧠 Traduction des phrases humaines en commandes machines :
                    if (analyse.intention === 'performance' || texteMinuscule.includes('bilan des manager') || texteMinuscule.includes('activité des manager')) {
                        commandeSecrete = '!bilan';
                    }
                    else if (analyse.intention === 'rapport' && (texteMinuscule.includes('semaine') || texteMinuscule.includes('7 jours'))) {
                        commandeSecrete = '!semaine';
                    }
                    else if (analyse.intention === 'incidents' && texteMinuscule.includes('non résolu')) {
                        commandeSecrete = '!incidents';
                    }
                    else if (analyse.intention === 'etat_centre' || texteMinuscule.includes('statut') || texteMinuscule.includes('temps réel')) {
                        commandeSecrete = '!statut';
                    }

                    // 🚀 Si l'IA a compris ce que tu voulais, elle lance la commande secrète
                    if (commandeSecrete) {
                        console.log(`🧠 [NLP] Le boss a dit "${texteBrut}". L'IA exécute secrètement : ${commandeSecrete}`);
                        const commandeTraitee = await gererCommandesPatron(sock, jid, commandeSecrete);
                        
                        // Si la commande a fonctionné, on arrête ici pour ne pas relancer une conversation IA normale
                        if (commandeTraitee) continue; 
                    }
                }
            }
        }

        // ==========================================
        // 💰 INTERCEPTEUR GLOBAL : RAPPORTS USD (Privé & PR Terrain)
        // ==========================================
        const texteMessage = extraireTexte(msg) || '';
        
        const idBrut = jid.split('@')[0].split(':')[0]; 
        const nomExpediteur = msg.pushName || idBrut;
        
        const identifiantsAutorises = [
            String(config.monNumero), 
            String(config.secondaireNumero),
            String(config.monLid),
            String(config.secondaireLid)
        ];
        
        const estMessagePriveAutorise = !jid.includes('@g.us') && identifiantsAutorises.includes(idBrut);
        const estGroupePRTerrain = (jid === '120363409129431148@g.us');

        const contientAlerteUSD = texteMessage.toUpperCase().includes('USD') || 
                                  texteMessage.includes('$') || 
                                  texteMessage.toLowerCase().includes('dollars');

        if ((estGroupePRTerrain || estMessagePriveAutorise) && contientAlerteUSD) {
            
            const heureMessage = new Date().getHours();
            const estDansCreneau = (heureMessage >= 22 || heureMessage < 5);

            if (estDansCreneau) {
                // ✅ NOUVEAU REGEX : 
                // 1. Exige de commencer par un chiffre ([\d])
                // 2. Cherche tous les montants du message (/g) pour ne pas se tromper
                const regexUSD = /([\d][\d\s.,]*)\s*(?:\$|usd)/gi;
                let montantPropre = 0;
                let match;
                
                // On boucle sur tous les montants trouvés (ex: "2.290 $" puis "1 $")
                while ((match = regexUSD.exec(texteMessage)) !== null) {
                    let chiffreBrut = match[1];
                    // Nettoyage
                    let texteNettoye = chiffreBrut.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
                    let valeur = parseFloat(texteNettoye);
                    
                    // 🛡️ SÉCURITÉ : On ignore "1$" (le taux) ou les montants absurdes
                    if (valeur > 1) {
                        montantPropre = valeur;
                        break; // On a trouvé la vraie recette, on s'arrête !
                    }
                }

                if (montantPropre > 0) {
                    console.log(`💸 Montant USD détecté (par ${nomExpediteur}) : ${montantPropre}$`);
                    
                    const sheet = require('./googleSheets');
                    await sheet.enregistrerRecetteUSD(montantPropre);
                    if (assistant?.notifierUSD) {
                        await assistant.notifierUSD(montantPropre);
                    }
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                        text: `📊 *Google Sheets mis à jour !*\n${montantPropre}$ enregistrés dans le tableau USD (ajouté par *${nomExpediteur}*).` 
                    });

                    if (estMessagePriveAutorise) {
                        await sock.sendMessage(jid, { text: `✅ Bien reçu ! La recette de ${montantPropre}$ a été enregistrée avec succès.` });
                        return; // Bloque le reste
                    }
                }

            } else {
                console.log(`⏳ Montant USD ignoré : détecté à ${heureMessage}h (Hors créneau 22h-5h).`);
                
                if (estMessagePriveAutorise) {
                    await sock.sendMessage(jid, { text: `❌ Enregistrement refusé. Le rapport USD n'est accepté qu'entre 22h00 et 04h59.\nHeure actuelle : ${heureMessage}h.` });
                    return;
                }
            }
        }
        
        // 1. TRAITEMENT DES MESSAGES DE GROUPES SURVEILLÉS
        if (jid.includes('@g.us') && (config.groupesSurveilles.includes(jid) || jid === GROUPE_SYNCHRO)) {
            await gererMessageGroupe(sock, msg, jid, memoire, assistant);
            continue;
        }

        // Fix 17 : intercepter "résolu" dans le groupe Disparus avec la NOUVELLE SÉCURITÉ
        if (jid === GROUPE_DISPARUS) {
            const texteBrut = extraireTexte(msg);
            
            // 🚨 Utilise la nouvelle fonction sécurisée !
            const idsResolus = extraireIdsResolusSecurise(texteBrut); 

            if (idsResolus && idsResolus.length > 0) {
                for (const machineId of idsResolus) {
                    try { await db.marquerIncidentResolu(machineId); } catch (e) {}
                }
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                    text: `✅ Résolution capturée depuis Disparus : IDs ${idsResolus.join(', ')} marqués résolus en DB.`
                });
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
                        const rapportFixtureFinal = `*Fixtures sport betting kingasani shop*\nNb. Pages: ${pages}\nNb.Copies par agent: ${copiesParAgent}\nFixture (other)\nloto: ${d.loto || 0}\nGiga: ${d.giga || 0}\nFélicitation : ${d.felicitation || 0}\nTotal/agt: ${totalParAgent}\n----------------\nTaux de change\nAchat: ${d.taux_achat || '?'}\nVente: ${d.taux_vente || '?'}`;
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
async function gererMessageGroupe(sock, msg, jid, memoire, assistant) {
    const participantJid = msg.key.participant || msg.key.remoteJid || '';
    
    // ==========================================
    // 🛡️ LE VIGILE HYBRIDE (FILTRE DE SÉCURITÉ)
    // ==========================================
    const MANAGERS_AUTORISES = [
        '42967356150013@lid',  // Timothé Le Noir
        '265515029283001@lid', // Deborah Kavunga
        '90263603159168@lid',  // Trésor bk
        '169230989307948@lid',  // Erick kenzo (Eric pos man)
        '51583027036329@lid',   // Vero (Ass. Manager)
        '155023019364375@lid' // Blaise (Ass. Manager)
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
        jid === '120363409129431148@g.us' ||      // Rapport PR terrain
        jid === '243900435187-1578719495@g.us' || // Agent Visité
        jid === '243907634105-1540987363@g.us'    // Pénalités
    );

    if (!estGroupeOuvert && !estManagerAutorise && !estPatron) {
        return; // Le vigile bloque
    }

    const expediteur = msg.pushName || participantJid.split('@')[0] || 'Inconnu';
    const texteBrut = extraireTexte(msg);

    const estVideo = !!(msg.message?.videoMessage);
    const estImage = !!(msg.message?.imageMessage);
    const estMedia = !!(estImage || estVideo || msg.message?.documentMessage || msg.message?.documentWithCaptionMessage);
    const texteStocke = estMedia && !texteBrut ? '[Média sans légende]' : texteBrut;

    if (!texteBrut && !estMedia) return; 

    // ⚠️ CORRECTION : On calcule texteNormalise ICI, avant que l'Oeil de Lynx ne s'en serve !
    const texteNormalise = (texteBrut || '').toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    console.log(`📌 EXPEDITEUR | JID: ${participantJid} | Nom: ${expediteur} | Texte: ${texteNormalise.substring(0, 50)}...`);

    // ==========================================
        // 🛡️ CHANTIER 2 : LE BUREAU DES APPROBATIONS (Points 8, 9, 10)
        // ==========================================
        // 🛑 UNIQUEMENT DANS SYNCHRO et on ne bloque pas le Boss !
        // 🛡️ SÉCURITÉ : On exclut le rapport de fermeture et les confirmations déjà approuvées
            const estRapportFermeture = texteNormalise.includes('dernier rapport') || texteNormalise.includes('etat des stocks') || texteNormalise.includes('état des stocks');
            const estDejaApprouve = texteNormalise.includes('approuvée') || texteNormalise.includes('approuvee');
            
           
   // ==========================================
    // 👁️ CHANTIER 3 : L'ŒIL DE LYNX (Validation des Médias)
    // ==========================================
    if (estDansSynchro || jid === '243900435187-1578719495@g.us') {
        
        // 🎥 Règle 1 : Vidéo Charging Room obligatoire (Pas de photo, pas de texte)
        if (texteNormalise.includes('charging room') || texteNormalise.includes('charging')) {
            if (!estVideo) {
                const sujet = `Le manager @${expediteur} vient d'envoyer un message sur le "charging room" mais sans y joindre la VRAIE vidéo. Rappelle-lui que le règlement (Point 14) exige une vidéo de la salle, et qu'un simple texte ou photo ne suffit pas.`;
                const msgRappel = await agentDialogueManager(sujet, expediteur);
                await sock.sendMessage(jid, { text: msgRappel, mentions: [participantJid] });
                return; // 🛑 On bloque le traitement !
            }
        }

        // 📸 Règle 2 : Captures de présences (Sheets) obligatoires
        if (texteNormalise.includes('présence') || texteNormalise.includes('presence') || texteNormalise.includes('sheet')) {
            if (!estImage) {
                const sujet = `Le manager @${expediteur} parle des présences/sheets mais n'a pas joint de capture d'écran (image). Rappelle-lui le Point 6 du règlement : il faut obligatoirement la capture visuelle.`;
                const msgRappel = await agentDialogueManager(sujet, expediteur);
                await sock.sendMessage(jid, { text: msgRappel, mentions: [participantJid] });
                return; // 🛑 On bloque le traitement !
            }
        }

        // ⏱️ Règle 3 : Traque du message "Call me"
        if (texteNormalise.includes('call me') || texteNormalise.includes('callme')) {
            const sujet = `Le manager @${expediteur} vient de signaler un "call me". Accuse réception poliment. Dis-lui que le chrono de résolution est lancé et qu'il ne doit surtout pas oublier d'envoyer une capture d'écran une fois le problème résolu (Point 12).`;
            const msgCallMe = await agentDialogueManager(sujet, expediteur);
            await sock.sendMessage(jid, { text: msgCallMe, mentions: [participantJid] });
            // Ici, on laisse passer le message dans le système
        }
    } // <-- C'est cette accolade qui manquait pour fermer le Chantier 3 !

        // ==========================================
        // 🎥 SAUVEGARDE VIDEO CHARGING ROOM (Point 14)
        // ==========================================
        if (estDansSynchro && estVideo) {
            const heureVideo = new Date().getHours();
            if (heureVideo >= 9 && heureVideo <= 11) {
                try {
                    await db.sauvegarderReport('video_charging', { expediteur }, participantJid, true, null);
                    console.log(`✅ Vidéo charging room reçue de ${expediteur} → DB sauvegardée.`);
                } catch(e) {}
            }
        }
    // ✅ CAPTURE APPROBATION PAR COORDINATEUR (Patron)
if (estPatron) {
    const estApprobation = (
        texteNormalise.includes('approuvé') ||
        texteNormalise.includes('approuve') ||
        texteNormalise.includes('validé') ||
        texteNormalise.includes('valide') ||
        texteNormalise.includes('ok go') ||
        texteNormalise.includes('accord') ||
        texteNormalise.includes('autorisé') ||
        texteNormalise.includes('autorise')
    );

    if (estApprobation) {
        // Notifier le patron
        await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
            text: `✅ *APPROBATION ENREGISTRÉE*\n\n*Par :* ${expediteur}\n*Message :*\n"${texteBrut}"`
        });

        // Notifier les managers qui avaient fait une demande
        for (const [managerJid] of Object.entries(MANAGERS_APPROBATION)) {
            const demande = derniereDemande.get(managerJid);
            if (demande && (Date.now() - demande.timestamp < 8 * 60 * 60 * 1000)) {
                try {
                    await sock.sendMessage(managerJid, {
                        text: `✅ *APPROBATION ACCORDÉE*\n\nVotre demande a été approuvée par *${expediteur}*.\n\nVous pouvez procéder !`
                    });
                    derniereDemande.delete(managerJid);
                } catch(e) {}
            }
        }
    }
}

    // 🛡️ CHANTIER 2 : LE BUREAU DES APPROBATIONS
if (!estPatron) {
    const estUnRapportOfficiel = (
        texteNormalise.includes('dernier rapport') || 
        texteNormalise.includes('etat des stocks') || 
        texteNormalise.includes('état des stocks') ||
        texteNormalise.includes('rapport actuel') ||
        texteNormalise.includes('etat actuel') ||
        texteNormalise.includes('rapport pos') ||
        texteNormalise.includes('nbre des clients') ||
        texteNormalise.includes('ouverture') || 
            texteNormalise.includes('team composition') || 
            texteNormalise.includes('matériel') || 
            texteNormalise.includes('materiel') ||
            texteNormalise.includes('etat d activites') ||
            texteNormalise.includes('état d activités') ||
            texteNormalise.includes('rapport actuel') ||
            texteNormalise.includes('nombre des clients') ||
            texteNormalise.includes('fixture') ||
            texteNormalise.includes('charging') ||
            texteNormalise.includes('connexion') ||
        texteNormalise.includes('nombre des clients')
    );
    const estDejaApprouve = texteNormalise.includes('approuvée') || texteNormalise.includes('approuvee');

    if (!estUnRapportOfficiel && !estDejaApprouve) {
        const demandeApprobation = (
            texteNormalise.includes('approbation') ||
            texteNormalise.includes('besoin de') ||
            (texteNormalise.includes('demande') && (
                texteNormalise.includes('argent') || 
                texteNormalise.includes('matériel') || 
                texteNormalise.includes('materiel') || 
                texteNormalise.includes('fc') || 
                texteNormalise.includes('achat') || 
                texteNormalise.includes('sortie')
            )) ||
            texteNormalise.includes('sanction') ||
            texteNormalise.includes('changement de shift') ||
            texteNormalise.includes('dépense') ||
            texteNormalise.includes('depense')
        );

        if (demandeApprobation) {
            if (gestionnaireManagers) await gestionnaireManagers.penaliserManager(participantJid, 'decisions_non_autorisees');

            // 💾 Mémoriser la demande si c'est un manager de la liste
            if (MANAGERS_APPROBATION.hasOwnProperty(participantJid)) {
                derniereDemande.set(participantJid, { expediteur, texteBrut, timestamp: Date.now() });
            }

            if (estDansSynchro) {
                // Réponse dans le groupe Synchro
                const sujet = `Le manager @${expediteur} formule une demande d'approbation. Parle EN TANT QUE DIRECTION. Dis-lui fermement que c'est en cours d'analyse et interdit d'engager quoi que ce soit avant validation.`;
                const msgBlocage = await agentDialogueManager(sujet, participantJid.split('@')[0]);
                await sock.sendMessage(jid, { text: msgBlocage, mentions: [participantJid] });
            } else {
                // Réponse en PRIVÉ au manager
                const sujet = `Le manager vient de formuler une demande d'approbation dans le groupe ${NOMS_GROUPES[jid] || jid}. Dis-lui EN PRIVÉ que sa demande est bien reçue, en cours d'analyse, et qu'il ne doit rien engager avant validation.`;
                const msgPrive = await agentDialogueManager(sujet, participantJid.split('@')[0]);
                await sock.sendMessage(participantJid, { text: msgPrive });
            }

            // 📩 Notification patron
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                text: `🛡️ *DEMANDE D'APPROBATION*\n\n*Manager :* ${expediteur}\n*Groupe :* ${NOMS_GROUPES[jid] || jid}\n*Message :*\n"${texteBrut}"\n\n👉 ${estDansSynchro ? 'Répondu dans le groupe.' : 'Manager notifié en privé.'}`
            });
            return;
        }
    }
}
    // ==========================================
    // 🧑‍💼 CHANTIER 4 : L'ANALYSTE RH & TECHNIQUE
    // ==========================================
    if (estDansSynchro) {
        // 🚨 4A : Traque des Pannes Matérielles (Point 7)
        if (texteNormalise.includes('panne') || texteNormalise.includes('problème') || texteNormalise.includes('probleme') || texteNormalise.includes('ne marche pas')) {
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, {
                text: `🚨 *FLASH TECHNIQUE* 🚨\n\n*Manager :* ${expediteur}\n*Groupe :* ${NOMS_GROUPES[jid] || jid}\n*Signalement :*\n"${texteBrut}"\n\n👉 J'ai détecté un potentiel problème matériel sur le terrain (Point 7).`
            });
        }

        // 👥 4B : Traque des Absences sans justification (Point 2)
        if (texteNormalise.includes('rapport pos') || texteNormalise.includes('pos en charge')) {
            const parleAbsence = texteNormalise.includes('absent') || texteNormalise.includes('manquant') || texteNormalise.includes('absence');
            
            // 🧠 CORRECTION : Regex strict pour ne cibler QUE les vrais zéros (0 ou 00) et ignorer 01, 02, 03...
            const zeroAbsence = /absences?\s*[:=]\s*0+\b/.test(texteNormalise) || /0+\s*absences?\b/.test(texteNormalise) || /absent\s*[:=]\s*0+\b/.test(texteNormalise);

            if (parleAbsence && !zeroAbsence) {
                
                const justifications = ['malad', 'raison', 'permission', 'retard', 'inconnu', 'sanction', 'renvoi', 'fuite', 'vol', 'décès', 'deces', 'famille', 'deplacement', 'repos', 'conge', 'congé', 'reliquat', 'dette', 'suspendu', 'id', 'cassure', 'cassures', 'dysfonctionnement', 'panne', 'problème', 'probleme'];
                const aUneJustification = justifications.some(mot => texteNormalise.includes(mot));
                
                if (!aUneJustification) {
                    const sujet = `Le manager vient de signaler une absence dans son rapport POS, mais n'a donné AUCUNE RAISON. Rappelle-lui que le Point 2 du règlement exige de spécifier les raisons des absences, et demande-lui poliment mais fermement de justifier.`;
                    
                    // 👈 On utilise le NUMÉRO pour que le tag fonctionne en bleu !
                    const msgRappel = await agentDialogueManager(sujet, participantJid.split('@')[0]);
                    await sock.sendMessage(jid, { text: msgRappel, mentions: [participantJid] });
                }
            }
        }
        // 💸 4C : Pression sur les absences pour "Reliquat"
        // Se déclenche si le mot reliquat est dans le rapport POS, ou si le message est une réponse très courte (ex: "1363018 reliquat")
        if (texteNormalise.includes('reliquat') || texteNormalise.includes('dette')) {
            if (texteNormalise.includes('absence') || texteNormalise.includes('absent') || texteNormalise.length < 50) {
                
                const sujet = `Le manager justifie une absence par un "reliquat" (un manquant d'argent). Dis-lui que c'est bien noté, mais exige fermement qu'il suive ce cas de très près pour qu'il soit résolu au plus vite, afin d'éviter les absences prolongées dans le réseau.`;
                
                const msgRappel = await agentDialogueManager(sujet, participantJid.split('@')[0]);
                await sock.sendMessage(jid, { text: msgRappel, mentions: [participantJid] });
            }
        }
    }

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

    // Si le message vient de ces deux groupes précis, on exige "Kingasani"
    if (estGroupeVisiteAllShop || estGroupePenaliteAllShop) {
        if (!texteNormalise.includes('kingasani') && !texteNormalise.includes('kinga')) {
            doitSauvegarder = false; // On bloque TOUT pour Kinkole, Mateté, DGC, etc.
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
        console.log(`🚫 [FILTRE GLOBAL] Message de ${expediteur} ignoré (Hors Kingasani).`);
    }
    
    const heureActuelle = new Date().getHours();

    
    // =================================================================
    // 🗼 INTERCEPTEUR GLOBAL DE CLÔTURE — UNIQUEMENT DANS SYNCHRO
    // =================================================================
    if (estDansSynchro) {

        // =================================================================
        // 🚨 LE HARCELEUR INTELLIGENT : Relance polie à 10h, harcèlement à 12h
        // =================================================================
        
        // On vérifie que le manager ne poste pas un rapport officiel avant de le déranger
        const estUnRapportOfficiel = texteNormalise.includes('ouverture') || 
                                     texteNormalise.includes('team composition') || 
                                     texteNormalise.includes('matériel') || 
                                     texteNormalise.includes('materiel') ||
                                    texteNormalise.includes('etat d activites actuel') ||
                                    texteNormalise.includes('état d activités actuel') ||
                                    texteNormalise.includes('rapport actuel 15h') ||
                                    texteNormalise.includes('rapport actuel 13h') ||
                                    texteNormalise.includes('nbre des clients') ||
                                    texteNormalise.includes('nombre des clients') ||
                                     texteNormalise.includes('fixture');
        

        // Déclenchement UNIQUEMENT si on est après 10h ET que ce n'est pas un rapport officiel
        if (estManagerAutorise && heureActuelle >= 10 && !estUnRapportOfficiel) {
            try {
                const incidents = await db.getIncidentsNonResolus();
                
                // S'il y a des incidents en cours...
                if (incidents && incidents.length > 0) {
                    
                    const tenteDeRepondre = texteNormalise.includes('résolu') || 
                        texteNormalise.includes('resolu') || 
                        texteNormalise.includes('non résolu') ||
                        texteNormalise.includes('non resolu');

                        const estMessageHorsSujet = (
                            texteNormalise.includes('annulation') ||
                            texteNormalise.includes('versement') ||
                            texteNormalise.includes('demande t-shirt') ||
                            texteNormalise.includes('demande tshirt') ||
                            texteNormalise.includes('demande matériel') ||
                            texteNormalise.includes('achat carburant') ||
                            texteNormalise.includes('présent au shop') ||
                            texteNormalise.includes('ir ') ||  // inspecteur
                            texteNormalise.includes('carburant')
                        );
                                            
                    if (!tenteDeRepondre && !estMessageHorsSujet) {
                        const maintenant = Date.now();
                        const dernierRappel = cooldownRelance.get(participantJid) || 0;
                        
                        // 🕒 Rythme de relance : 1h d'attente le matin (poli), 15 min l'après-midi (agressif)
                        const delaiAntiSpam = (heureActuelle < 12) ? (60 * 60 * 1000) : (15 * 60 * 1000); 
                        
                        if (maintenant - dernierRappel > delaiAntiSpam) {
                            
                            const idsNonResolus = [...new Set(incidents.map(i => i.machineId))].join(', ');
                            const exempleId = incidents[0].machineId; 
                            
                            //let msgRappel = "";
                            
                            const incidentLePlusAncien = incidents.reduce((a, b) => 
                                    new Date(a.dateDeclaration) < new Date(b.dateDeclaration) ? a : b
                                );
                                const maintenant2 = new Date();
                                const ageJours = Math.floor((maintenant2 - new Date(incidentLePlusAncien.dateDeclaration)) / (1000 * 60 * 60 * 24));
                                
                                let sujetHarceleur;
                                if (ageJours === 0) {
                                    sujetHarceleur = heureActuelle < 12
                                        ? `Demander poliment à ce manager si le reliquat des IDs ${idsNonResolus} est résolu ce matin. Lui rappeler de répondre : "${exempleId} résolu" ou "${exempleId} non résolu".`
                                        : `Rappeler fermement mais avec respect que le reliquat des IDs ${idsNonResolus} n'est toujours pas clôturé aujourd'hui. Une réponse est attendue : "${exempleId} résolu" ou "${exempleId} non résolu".`;
                                } else if (ageJours === 1) {
                                    sujetHarceleur = `Rappeler avec sérieux à ce manager que les IDs ${idsNonResolus} traînent depuis hier sans réponse. C'est inacceptable. Exiger une réponse immédiate et claire : "${exempleId} résolu" ou "${exempleId} non résolu". Mentionner que cela commence à poser un problème de gestion.`;
                                } else {
                                    sujetHarceleur = `Interpeller fermement ce manager : les IDs ${idsNonResolus} sont non clôturés depuis ${ageJours} jours. C'est une situation grave qui ne peut plus durer. Exiger une réponse définitive aujourd'hui même, avec le modèle : "${exempleId} résolu" ou "${exempleId} non résolu". Rappeler que des sanctions sont prévues pour les négligences répétées.`;
                                }
                                
                                const msgRappel = await agentDialogueManager(sujetHarceleur, participantJid.split('@')[0]);
                            
                            // 🔒 FIX : On enregistre l'heure AVANT d'envoyer le message pour bloquer les tirs groupés
                            cooldownRelance.set(participantJid, maintenant);
                            
                            await sock.sendMessage(jid, {
                                text: msgRappel,
                                mentions: [participantJid]
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("Erreur lors de la vérification du harceleur :", err.message);
            }
        }
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

        const estNonCloture = !estRapportAutre && 
            !texteNormalise.includes('déclaré par') && // 🛑 Ignore la propre confirmation du bot
            //!texteNormalise.includes('action requise') && // 🛑 Ignore le message de la Tour de Contrôle
            (
            // Formulations directes (avec les "é" ajoutés)
            texteNormalise.includes('non cloture') || 
            texteNormalise.includes('non clôture') || 
            texteNormalise.includes('non cloturé') || 
            texteNormalise.includes('non clôturé') || 
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
        const contientIDMachine = /[0-9]{5,7}/.test(texteNormalise);

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
            
            // 🛡️ SÉCURITÉ ANTI-BLOCAGE : On filtre les messages normaux
            const ressembleAReponse = /[0-9]{5,7}/.test(texteNormalise) || 
                                      texteNormalise.includes('cloture') || 
                                      texteNormalise.includes('clôture') || 
                                      texteNormalise.includes('resolu') || 
                                      texteNormalise.includes('résolu') || 
                                      texteNormalise.includes('ok');
            

           const estRapportActuelOuConnexion = (
                texteNormalise.includes('rapport actuel') ||
                texteNormalise.includes('etat actuel') ||
                texteNormalise.includes('nbre des clients') ||
                texteNormalise.includes('détails connexion') ||
                texteNormalise.includes('details connexion') ||
                texteNormalise.includes('ids connecté') ||
                texteNormalise.includes('instant win') ||
                texteNormalise.includes('tickets loto')
            );
            
            if (ressembleAReponse && !estRapportActuelOuConnexion) {
                // ÉTAPE A : On attendait "oui/non/IDs" après la question de 23h
                if (attente.etape === 'ATTENTE_REPONSE_23H') {
                    if (estBilanOk) {
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
                        const incidents = parserIncidentsFormat(texteBrut);
                        if (incidents.length > 0) {
                            etatAttente.delete(jid);
                            await traiterIncidentsValides(sock, incidents, expediteur, participantJid, assistant);
                        } else {
                            etatAttente.set(jid, { etape: 'ATTENTE_DECLARATION', timestamp: Date.now() });
                            if (typeof sauvegarderEtatAttente === 'function') await sauvegarderEtatAttente();
                            await sock.sendMessage(jid, {
                                text: `⚠️ @${participantJid.split('@')[0]}, le format est incorrect.\nIl manque les montants.\n\n📝 *Modèle attendu (23h) :*\nNon clôturé\n421596 = 150000`,
                                mentions: [participantJid]
                            });
                        }
                        return;
                    }

                    await sock.sendMessage(jid, {
                        text: `❓ @${participantJid.split('@')[0]}, réponse non reconnue.\n• Dites *"Tout est ok"*\n• Ou envoyez la liste avec les montants (ex: 421596 = 150000)`,
                        mentions: [participantJid]
                    });
                    return;
                }

                // ÉTAPE B : Attente de correction (Matin/Journée = Résolution | Soir = Déclaration)
                if (attente.etape === 'ATTENTE_FORMAT' || attente.etape === 'ATTENTE_DECLARATION') {
                    const incidents = parserIncidentsFormat(texteBrut);

                    if (incidents.length > 0) {
                        etatAttente.delete(jid);
                        await traiterIncidentsValides(sock, incidents, expediteur, participantJid, assistant);
                    } else {
                        const estErreurSoir = (attente.etape === 'ATTENTE_DECLARATION' || heureActuelle >= 22);
                        
                        const msgErreur = estErreurSoir 
                            ? `⚠️ @${participantJid.split('@')[0]}, format incorrect.\nVous devez mettre un signe "=" et le montant.\n\n📝 *Exemple attendu :*\nNon clôturé\n421596 = 150000`
                            : `⚠️ @${participantJid.split('@')[0]}, format incorrect.\nVous devez ajouter le mot *"résolu"* après l'ID pour le clôturer.\n\n📝 *Exemple attendu :*\n369439 résolu`;

                        await sock.sendMessage(jid, {
                            text: msgErreur,
                            mentions: [participantJid]
                        });
                    }
                    return;
                }
            }
        }

        // ─────────────────────────────────────────────────────────
        // 🟢 CAS 1 : RÉSOLUTION D'UN RELIQUAT (Priorité absolue)
        // ─────────────────────────────────────────────────────────
        if (estResolution) {
            const idsResolus = extraireIdsResolusSecurise(texteBrut);
            
            if (idsResolus && idsResolus.length > 0) {
                for (const machineId of idsResolus) {
                    try { await db.marquerIncidentResolu(machineId); } catch (err) {}
                }
                
                const phraseResolution = idsResolus.length > 1 
                    ? `les ids ${idsResolus.join(', ')} — reliquat réglé ✅` 
                    : `l'id ${idsResolus[0]} — reliquat réglé ✅`;

                await sock.sendMessage(GROUPE_DISPARUS, { text: `✅ Mise à jour : ${phraseResolution}` });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: `✅ Reliquat clos en DB : ${idsResolus.join(', ')}` });
                return; // 👈 Stoppe la lecture ici ! Le bot ignore le reste du texte collé.
            }
        }

        // ─────────────────────────────────────────────────────────
        // 🟠 CAS 2 : LE RELIQUAT PERSISTE (Réponse au harceleur)
        // ─────────────────────────────────────────────────────────
        if (texteNormalise.includes('non resolu') || texteNormalise.includes('non résolu')) {
            const idDetecte = texteNormalise.match(/[0-9]{5,7}/);
            
            if (idDetecte) {
                await sock.sendMessage(jid, { 
                    text: `⚠️ C'est noté pour l'ID ${idDetecte[0]}. Le reliquat persiste.\n👉 Merci de continuer le suivi avec l'agent.` 
                });
                return;
            }
        }

        // ─────────────────────────────────────────────────────────
        // 🔴 CAS 3 : DÉCLARATION D'UN NOUVEAU RELIQUAT (De 22h00 à 04h59)
        // ─────────────────────────────────────────────────────────
        const estTentativeNonCloture = estNonCloture || (!estRapportAutre && contiendIdsSeuls(texteBrut));

        if (estTentativeNonCloture) {
            const estDansFenetreNonCloture = (heureActuelle >= 22 || heureActuelle < 5);

            if (!estDansFenetreNonCloture) {
                console.log(`⏳ [REFUSÉ] Tentative de non-clôturé par ${expediteur} à ${heureActuelle}h (Hors fourchette).`);
                
                await sock.sendMessage(jid, { 
                    text: `❌ *Signalement refusé.*\n\nLes déclarations de nouveaux reliquats ne sont acceptées qu'à partir de *22h00*.\n\n(Il est actuellement ${heureActuelle}h, veuillez patienter).` 
                });
                return;
            }

            const incidents = parserIncidentsFormat(texteBrut);

            if (incidents.length > 0) {
                await traiterIncidentsValides(sock, incidents, expediteur, participantJid, assistant);
            } else {
                etatAttente.set(jid, { etape: 'ATTENTE_DECLARATION', timestamp: Date.now() });
                if (typeof sauvegarderEtatAttente === 'function') await sauvegarderEtatAttente();

                await sock.sendMessage(jid, {
                    text: `⚠️ @${participantJid.split('@')[0]}, j'ai bien capté le rapport, mais il manque les montants.\n\n📝 *Modèle attendu :*\nNon clôturé\n421596 = 150000`,
                    mentions: [participantJid]
                });
            }
            return;
        }

        // ─────────────────────────────────────────────────────────
        // 🔵 CAS 4 : TOUT EST OK
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
    
    // 1️⃣ GROUPE : Rapport PR terrain (Transfert GLOBAL, Sauvegarde KINGASANI)
    if (jid === '120363409129431148@g.us') {
        
        // 🛑 On bloque le patron pour éviter de fausser les stats
        if (estPatron) return; 

        // 🛑 On vérifie que c'est un vrai rapport d'agent (pour éviter de transférer des "bonjour")
        if (!texteNormalise.includes('p.d.v') && !texteNormalise.includes('pdv') && !texteNormalise.includes('ticket')) {
            return; 
        }
        
        try {
            // 🚀 1. TRANSFERT GLOBAL : On envoie TOUS les rapports (Masina, DGC, Kingasani...)
            await sock.sendMessage('243900435187-1578719495@g.us', { text: texteStocke });
            console.log(`✅ [TRANSFERT RÉUSSI] Rapport de ${expediteur} envoyé dans Visite Agents !`);

            // 💾 2. SAUVEGARDE CIBLÉE : On enregistre en DB UNIQUEMENT pour Kingasani
            if (texteNormalise.includes('kingasani') || texteNormalise.includes('kingas')) {
                await db.sauvegarderVisiteTerrain(participantJid, texteStocke, 'Rapport PR');
                console.log(`✅ [DB] Rapport Kingasani sauvegardé pour ${expediteur}.`);
            } else {
                console.log(`ℹ️ [DB IGNORÉ] Rapport de ${expediteur} transféré mais non sauvegardé (Hors Kingasani).`);
            }
            
        } catch (erreur) {
            console.error(`❌ [ERREUR PR TERRAIN] :`, erreur.message);
        }
        return;
    }
    
    // 2️⃣ GROUPE : Agent en ordre & Visité
    if (jid === '243900435187-1578719495@g.us') { 
        if (estPatron) return; 
        
        if (texteNormalise.includes('kingasani') || texteNormalise.includes('kingas')) {
            await db.sauvegarderVisiteTerrain(participantJid, texteStocke, 'Agent Visité');
        }
        return;
    }

    // 3️⃣ GROUPE : PENALITy QS all shop
    if (jid === '243907634105-1540987363@g.us') {
        if (texteNormalise.includes('kingasani') || texteNormalise.includes('kingas')) {
            await db.sauvegarderPenalite(participantJid, texteStocke);
        }
        return;
    }
    // =================================================================

    /// ── DÉTECTION DES AUTRES RAPPORTS STANDARDS (OUVERTURE, FIXTURE...) ──
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
        texteNormalise.includes("état d'activités") || // 👈 NOUVEAU
        texteNormalise.includes("etat d'activites") || // 👈 NOUVEAU
        texteNormalise.includes('rapport actuel') || 
        texteNormalise.includes('etat actuel') ||    
        texteNormalise.includes('etat actuel du shop') ||
        texteNormalise.includes('etat materiel') ||
        texteNormalise.includes('taux de change') ||
        texteNormalise.includes('taux') ||
        texteNormalise.includes('achat')
    );
    
   if (estProbablementRapport) {
            const analyseLocale = analyserRapport(texteBrut); 
            let typeLocal = analyseLocale.type;
            
            // 🧠 FORÇAGE ABSOLU : On sécurise les étiquettes pour que la Tour de Contrôle les trouve dans la base
            if (texteNormalise.includes('rapport actuel') || texteNormalise.includes('etat actuel') || texteNormalise.includes('état d activités')) {
                typeLocal = 'etat_actuel';
            } else if (texteNormalise.includes('rapport pos')) {
                typeLocal = 'pos';
            } else if (texteNormalise.includes('charging')) {
                typeLocal = 'video_charging';
            } else if (texteNormalise.includes('connexion 12h') || texteNormalise.includes('connexion 15h') || texteNormalise.includes('connexion 17h') || texteNormalise.includes('détails connexion')) {
                typeLocal = 'details_connexion';
            } else if (texteNormalise.includes('dernier rapport') || texteNormalise.includes('etat des stocks')) {
                typeLocal = 'fermeture';
            }
            
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
                // AJOUTER (assistant est passé depuis handleIncomingMessage)
                if (assistant?.notifierRapport) {
                    await assistant.notifierRapport({
                        expediteurJid: participantJid,
                        expediteur,
                        texte: texteBrut
                    }, typeLocal);
                }
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

                const rapportFixtureFinal = `*Fixtures sport betting kingasani shop*\n` +
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
