const config = require('../config');
const traiterMessage = require('./reportService');
const { detecterTypeRapport, verifierCompletude, getDestination } = require('./routeurRapports');
const db = require('./database'); 
const { analyserRapport, formaterRapportCoffre } = require('./reportEngine');
const cacheOuverture = new Map(); // 🧠 Mémoire pour retenir le nombre de pages du jour

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
                        await sock.sendMessage('120363021280044937@g.us', { text: demandeFixture });
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
                    else if (typeLocal === 'incident_cloture') {
                        const ids = analyse.donnees?.ids_non_clotures || [];
                        await sock.sendMessage('243900435187-1564716535@g.us', { text: msg.texte });
                        if (ids.length > 0) global.idsNonCloturesHier = ids;
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
/**
 * Gère la logique des messages reçus dans les groupes
 */
async function gererMessageGroupe(sock, msg, jid, memoire) {
    const participantJid = msg.key.participant || msg.key.remoteJid || '';
    
    // ==========================================
    // 🛡️ LE VIGILE HYBRIDE (FILTRE DE SÉCURITÉ)
    // ==========================================
    
    // 1. Liste exclusive des managers autorisés (LID purs)
    const MANAGERS_AUTORISES = [
        '42967356150013@lid',  // Timothé Le Noir
        '265515029283001@lid', // Deborah Kavunga
        '90263603159168@lid',  // Trésor bk
        '169230989307948@lid'  // Erick kenzo (Eric pos man)
    ];
    const estManagerAutorise = MANAGERS_AUTORISES.includes(participantJid);

    // 2. Passe-droit absolu pour le patron (Toi)
    const estPatron = (
        participantJid.includes(config.monNumero) || 
        participantJid.includes(config.secondaireNumero) || 
        participantJid === config.monLid || 
        participantJid === config.secondaireLid ||
        participantJid === '204685424214253@lid' // Ton LID principal
    );

    // 3. L'exception "Synchro Kinkole" : Tout message dans ce groupe est accepté
    const estDansSynchro = (jid === '120363021280044937@g.us');

    // 🛑 LE BLOCAGE : Si le message NE vient PAS de Synchro Kinkole 
    // ET que l'expéditeur n'est ni un manager autorisé, ni toi -> DEHORS !
    if (!estDansSynchro && !estManagerAutorise && !estPatron) {
        return; // Message ignoré silencieusement, il n'ira pas dans la base de données
    }
    // ==========================================

    const expediteur = msg.pushName || participantJid.split('@')[0] || 'Inconnu';

    const texteBrut = extraireTexte(msg);

    
    const estMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage || msg.message?.documentWithCaptionMessage);
    const texteStocke = estMedia && !texteBrut ? '[Média sans légende]' : texteBrut;

    if (!texteBrut) return; 

    const texteNormalise = texteBrut.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    console.log(`📌 EXPEDITEUR | JID: ${participantJid} | Nom: ${expediteur} | Texte: ${texteNormalise.substring(0, 50)}...`);

    // Sauvegarde en mémoire Redis
    await memoire.sauvegarderMessage(jid, {
        groupeJid: jid, groupeNom: NOMS_GROUPES[jid] || jid, expediteurJid: participantJid, expediteur, texte: texteStocke, estMedia, timestamp: Date.now()
    });

    // Sauvegarde dans PostgreSQL (Nouveau système)
    try {
        await db.upsertManager(participantJid, expediteur);
        await db.sauvegarderMessage(jid, participantJid, texteStocke, estMedia);
    } catch (e) {}

    // ==========================================
    // ⚙️ WORKFLOW : VALIDATION QUOTIDIENNE & RÉSOLUTION
    // ==========================================
    
    // 1. Réponse au "Tout est OK" 
    if (texteNormalise === 'oui' || texteNormalise === 'tout est ok' || texteNormalise.includes('cloture ok') || texteNormalise.includes('clôture normale') || texteNormalise.includes('tout le monde a cloture')) {
        
        // 💾 NOUVEAU : On enregistre que le bilan a été fait pour ne plus le déranger à 23h !
        try {
            await db.upsertManager(participantJid, expediteur || 'Manager Inconnu');
            await db.prisma.report.create({
                data: {
                    type: 'incident_cloture',
                    contenu: { statut: 'TOUT_EST_OK' },
                    managerJid: participantJid
                }
            });
        } catch (error) { console.error(error); }

        await sock.sendMessage(jid, { text: `✅ Merci, bien reçu. Bonne fin de journée !` });
        return;
    }

    // 2. Le manager annonce qu'un ID spécifique est "Résolu"
    if (texteNormalise.includes('resolu') || texteNormalise.includes('résolu')) {
        // On cherche les IDs dans son message
        const idsResolus = texteBrut.match(/\b\d{5,7}\b/g);
        
        if (idsResolus && idsResolus.length > 0) {
            for (const machineId of idsResolus) {
                await db.marquerIncidentResolu(machineId); // 💾 Mise à jour en base de données !
            }
            
            const phraseResolution = idsResolus.length > 1 
                ? `les ids ${idsResolus.join(', ')} le probleme est resolu` 
                : `l'id ${idsResolus[0]} le probleme est resolu`;

            await sock.sendMessage('243900435187-1564716535@g.us', { text: `✅ Mise à jour DB : ${phraseResolution}` });
            await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: `✅ Incident clos en DB pour : ${idsResolus.join(', ')}` });
            return;
        }
    }

    // 3. Capture automatique du format exigé : "ID = Montant"
    const regexIdMontant = /\b(\d{5,7})\s*=\s*([\d.,]+)\b/g;
    let matchId;
    const incidentsDetectes = [];
    
    while ((matchId = regexIdMontant.exec(texteBrut)) !== null) {
        incidentsDetectes.push({ id: matchId[1], montant: matchId[2] });
    }

    if (incidentsDetectes.length > 0) {
        const idsEnregistres = [];
        // On sauvegarde chaque ligne dans la DB
        for (const inc of incidentsDetectes) {
            await db.sauvegarderIncidentCloture(inc.id, inc.montant, participantJid);
            idsEnregistres.push(inc.id);
        }
        
        await sock.sendMessage('243900435187-1564716535@g.us', { 
            text: `⚠️ Incidents enregistrés en base de données avec succès pour les IDs : *${idsEnregistres.join(', ')}*.\nStatut actuel : *NON RÉSOLU*.`
        });
        return; // Le dossier est créé, on s'arrête là !
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
        texteNormalise.includes('etat d activites') ||
        texteNormalise.includes('etat materiel') ||
        texteNormalise.includes('taux de change') ||
        texteNormalise.includes('taux') ||
        texteNormalise.includes('achat') ||
        // 👇 LES NOUVEAUX MOTS CLÉS POUR LES INCIDENTS
        texteNormalise.includes('non clôture') ||
        texteNormalise.includes('non cloture') ||
        texteNormalise.includes("n'a pas clôturé") ||
        texteNormalise.includes("n'a pas cloture") ||
        texteNormalise.includes("n'ont pas clôturer") ||
        texteNormalise.includes("n'ont pas cloture") ||
        texteNormalise.includes("pas cloturer")
    );

    if (estProbablementRapport) {
        // 1. LE MOTEUR LOCAL EN PREMIER (Instantané et 100% hors-ligne)
        const analyseLocale = analyserRapport(texteBrut); 
        let typeLocal = analyseLocale.type;
        let iaType = "Non consultée";
        
        // 2. IA EN SECOURS (Uniquement si le moteur local ne comprend pas)
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

        // 3. DÉBUT DU ROUTAGE
        if (typeLocal !== 'inconnu') {
            const manager = config.managers[participantJid] || { nom: expediteur };

            // 💾 Sauvegarde dans la base de données
            try {
                await db.sauvegarderReport(typeLocal, analyseLocale.donnees || {}, participantJid, true, null);
                console.log(`✅ Rapport structuré (${typeLocal}) sauvegardé dans la base !`);
            } catch (e) {
                console.error('⚠️ Erreur écriture DB:', e.message);
            }

            // ==========================================
            // ⚙️ WORKFLOW 1 : OUVERTURE (Matin)
            // ==========================================
            if (typeLocal === 'ouverture') {
                const pages = analyseLocale.donnees?.pages_imprimees || 8;
                cacheOuverture.set('pages_kinkole', pages);
                await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: texteBrut });
                
                const heureActuelle = new Date().getHours();
                if (heureActuelle < 10) {
                    const demandeFixture = `✅ Ouverture validée.\n\nIl me manque les informations suivantes pour calculer les fixtures :\n• Taux d'achat USD\n• Taux de vente USD\n• Loto\n• Giga\n• Félicitations\n\n📝 *Modèle à utiliser :*\nTaux de change\nAchat: \nVente: \nLoto: \nGiga: \nFélicitation: `;
                    await sock.sendMessage('120363021280044937@g.us', { text: demandeFixture });
                }
                return;
            }

            // ==========================================
            // ⚙️ WORKFLOW 2 : CALCUL DES FIXTURES
            // ==========================================
            else if (typeLocal === 'fixture') {
                const d = analyseLocale.donnees || {};
                const pages = cacheOuverture.get('pages_kinkole') || 8; 
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
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: `✅ Fixture calculée et publiée avec succès !` });
                return;
            }

            // ==========================================
            // ⚙️ WORKFLOW 3 : FERMETURE (Dernier rapport)
            // ==========================================
            else if (typeLocal === 'fermeture') {
                await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: texteBrut });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                    text: `✅ *DERNIER RAPPORT* de *${manager.nom}* validé et transféré dans *Gestion Center*.` 
                });
                return;
            }

            // ==========================================
            // ⚙️ WORKFLOW 4 : DÉTAILS CONNEXION (3x / jour)
            // ==========================================
            else if (typeLocal === 'details_connexion') {
                await sock.sendMessage(config.groupesDestination.gestion_center.id, { text: texteBrut });
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                    text: `✅ *DÉTAILS CONNEXION* de *${manager.nom}* transféré dans *Gestion Center*.` 
                });
                return;
            }

            // ==========================================
            // ⚙️ WORKFLOW 5 : INCIDENTS & NON-CLÔTURÉS (STRICT DB)
            // ==========================================
            else if (typeLocal === 'incident_cloture') {
                const managerNom = manager.nom || expediteur;
                
                // 1. On accepte le format "ID = Montant" OU "ID : Montant" (et on ignore "fc" etc.)
                const regexIdMontant = /\b(\d{5,7})\s*[=:]\s*([\d.,]+)/g;
                let matchId;
                const incidentsDetectes = [];
                
                while ((matchId = regexIdMontant.exec(texteBrut)) !== null) {
                    incidentsDetectes.push({ id: matchId[1], montant: matchId[2] });
                }

                // 2. CAS A : Le format EST détecté (Ex: "342135 = 337950" ou "2195937 : 123.700fc")
                if (incidentsDetectes.length > 0) {
                    const idsEnregistres = [];
                    
                    // 💾 On sauvegarde chaque machine séparément dans PostgreSQL AVEC le montant
                    for (const inc of incidentsDetectes) {
                        await db.sauvegarderIncidentCloture(inc.id, inc.montant, participantJid);
                        idsEnregistres.push(inc.id);
                    }
                    
                    // 📝 On prépare le message pour le groupe (AUCUN MONTANT ICI, JUSTE LES IDs)
                    const phraseIds = idsEnregistres.length > 1 
                        ? `les ids ${idsEnregistres.join(', ')} n'ont pas cloturé` 
                        : `l'id ${idsEnregistres[0]} n'a pas cloturé`;

                    const messageMasque = `⚠️ *RAPPORT MACHINE NON CLÔTURÉE* ⚠️\n\n${phraseIds}`;

                    // 📤 On envoie le message au groupe des incidents (Montants invisibles)
                    await sock.sendMessage('243900435187-1564716535@g.us', { text: messageMasque });
                    
                    // 🔔 Notification en privé pour toi
                    await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { 
                        text: `⚠️ *RAPPORT NON CLÔTURÉ* de *${managerNom}* transféré.\n(Enregistré en DB avec le montant)` 
                    });
                    return;
                } 
                
                // 3. CAS B : Aucun ID ni montant détecté (Ex: "L'ID n'a pas cloturé")
                else {
                    const messageExigence = `⚠️ Rappory rejetée : Format incorrect.\n\nMerci de m'envoyer le rapport avec ce modèle  svp :\n\n*ID = montant* (ou *ID : montant*)\n*(Ex: 342135 = 337950 n'a pas cloturé)*`;
                    await sock.sendMessage(jid, { text: messageExigence });
                    return;
                }
            }
                
            // ==========================================
            // ⚙️ WORKFLOW CLASSIQUE (Rapports POS, PR Terrain, etc.)
            // ==========================================
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

    // ==========================================
    // 👑 FLUX PRIVÉ DU PATRON (LE COFFRE)
    // ==========================================
    if (texte.toLowerCase().includes('coffre')) {
        console.log('🔒 Rapport de coffre brut reçu du patron, formatage en cours...');
        try {
            const rapportFormate = formaterRapportCoffre(texte);
            
            // 1. Envoi WhatsApp
            await sock.sendMessage(config.groupesDestination.s_check.id, { text: rapportFormate });
            
            // 2. 💾 SAUVEGARDE EN BASE DE DONNÉES (Pour la Tour de Contrôle)
            await db.sauvegarderReport('coffre', { texte: texte }, jid, true, null);
            
            // 3. Confirmation
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

module.exports = {
    handleIncomingMessage,
    gererMessageGroupe,
    lancerRattrapageAutomatique
};
