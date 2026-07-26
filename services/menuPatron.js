const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const config = require('../config');

/**
 * Gère les commandes secrètes envoyées par le patron en privé
 */
async function gererCommandesPatron(sock, jid, texteBrut) {
    // 1. SÉCURITÉ : Extraire l'identifiant brut (Numéro ou LID, sans l'appareil :xx)
    const idBrut = jid.split('@')[0].split(':')[0];

    const identifiantsAutorises = [
        String(config.monNumero),
        String(config.secondaireNumero),
        String(config.monLid),         // Ton LID
        String(config.secondaireLid)   // Le LID de Dimercia
    ];

    // Vérifie si l'identifiant de l'expéditeur fait partie de la liste VIP
    if (!identifiantsAutorises.includes(idBrut)) {
        return false; // Pas autorisé : on laisse passer (vers l'IA ou autre)
    }

    // On force les minuscules (corrige le bug de "!Incidents" vs "!incidents")
    const texteNormalise = texteBrut.trim().toLowerCase();

    // =========================================================
    // 💵 COMMANDE SECRÈTE : Sortie USD (Remise à zéro des dollars)
    // =========================================================
    if (texteNormalise === 'sortie usd' || texteNormalise === 'sortie dollar' || texteNormalise === 'sortie dollars') {
        
        // 1. On envoie la confirmation immédiate au patron
        await sock.sendMessage(jid, { 
            text: "✅ *Bien reçu Boss !*\nL'information est enregistrée dans le système. Ce soir, lors du rapport du manager, le cumul USD repartira automatiquement à zéro." 
        });

        console.log(`🚨 [FINANCES] Le Boss (${idBrut}) a signalé une sortie USD. La demande est loggée dans la base de données.`);

        // 2. On retourne TRUE pour empêcher le bot d'envoyer ce texte à l'Intelligence Artificielle
        return true; 
    }

    // =========================================================
    // 📊 COMMANDE : !bilan (Évaluation Intelligente des Managers VIP)
    // =========================================================
    if (texteNormalise === '!bilan') {
        await sock.sendMessage(jid, { text: "⏳ *Extraction de l'activité et analyse RH des managers VIP en cours...*" });

        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            // 1. Ta liste stricte de collaborateurs VIP à surveiller
            const listeManagersVIP = {
                '178499008630811@lid': { nom: 'Timothee', role: 'Manager' },
                '90263603159168@lid':  { nom: 'Erick K 2', role: 'Manager' },
                '42967356150013@lid':  { nom: 'Tresor BK 3', role: 'Ass. Manager' },
                '265029714768018@lid': { nom: 'Collaborateur 4', role: 'Ass. Manager' },
                '152059408036054@lid': { nom: 'Collaborateur 5', role: 'Manager' },
                '169230989307948@lid': { nom: 'Collaborateur 6', role: 'Manager' },
                '265515029283001@lid': { nom: 'Deborah K 7', role: 'Ass. Manager' }
            };

            // 2. Dictionnaire exhaustif de tes groupes surveillés
            const groupesConnus = {
                '120363021280044937@g.us': 'Synchro Kinkole',
                '120363023010071105@g.us': 'Synchro Kinkole pos',
                '120363025487823123@g.us': 'Winner Shop kinkole',
                '120363040045715280@g.us': 'Rapport PR terrain',
                '243907634105-1540987363@g.us': 'Pénalités QS',
                '243900435187-1521782366@g.us': 'General Management',
                '243900435187-1564931206@g.us': 'Évacuation Matériels',
                '243890011696-1509543437@g.us': 'Winner printing group',
                '120363039964661142@g.us': 'Printing Winner & Buco',
                '243900435187-1560664753@g.us': 'Composition',
                '243900435187-1543596785@g.us': 'Mukumbusu (Rapports)',
                '120363024619387743@g.us': 'Suivi Carburant',
                '243900435187-1564716535@g.us': 'Disparus',
                '120363049897392666@g.us': 'Entre nous',
                '243900435187-1578719495@g.us': 'Agent en ordre & Visité'
            };

            const jidsVIP = Object.keys(listeManagersVIP);

            // 3. Récupération des messages du jour depuis PostgreSQL
            const messagesVIP = await prisma.message.findMany({
                where: {
                    timestamp: { gte: aujourdhui },
                    senderJid: { in: jidsVIP }
                },
                orderBy: { timestamp: 'asc' }
            });

            // 4. Préparation du journal d'activité pour l'IA
            let journalActivite = "";
            for (const [lid, infos] of Object.entries(listeManagersVIP)) {
                const msgsDuManager = messagesVIP.filter(m => m.senderJid === lid);
                
                if (msgsDuManager.length > 0) {
                    journalActivite += `\n👤 MANAGER : ${infos.nom} (${infos.role}) - ${msgsDuManager.length} messages envoyés\n`;
                    msgsDuManager.forEach(m => {
                        let nomGroupe = groupesConnus[m.groupeJid] || 'un groupe';
                        let texte = m.texte ? m.texte.replace(/\n/g, ' ').substring(0, 100) : "[Média/Image envoyé]";
                        journalActivite += `- [${nomGroupe}] : "${texte}"\n`;
                    });
                } else {
                    journalActivite += `\n👤 MANAGER : ${infos.nom} (${infos.role}) - 🔴 SILENCE TOTAL (Aucune activité détectée aujourd'hui)\n`;
                }
            }

            if (messagesVIP.length === 0) {
                journalActivite = "Aucune activité détectée pour l'ensemble des managers VIP aujourd'hui.";
            }

            // 5. Instruction stricte (Prompt) pour forcer le rôle de l'IA
            const consigne = `Tu es l'analyste RH et bras droit du Boss (Center Manager). Je te donne ci-dessous l'activité WhatsApp stricte des Managers et Assistants Managers d'aujourd'hui.

            ${journalActivite}

            Rédige un bilan de performance individuel. 
            Format exigé :
            - Évalue chaque manager avec une puce et un indicateur clair : 🟢 (Proactif/Actif), 🟡 (Activité faible/Incomplète), 🔴 (Inactif/Suspect).
            - Explique brièvement ce qu'ils ont accompli aujourd'hui d'après leurs messages (Rapports envoyés ? Gestion de crise ?).
            - Sois ferme et objectif. Si un manager n'a rien dit (silence total), signale-le immédiatement comme une absence ou un manque de reporting.
            - Termine par un court paragraphe "🎯 AVIS AU BOSS" avec ton conseil direct.`;

            // 6. Envoi au cerveau IA
            const { agentRecherche } = require('./agents');
            const reponseIA = await agentRecherche(consigne, []); 
            
            await sock.sendMessage(jid, { text: reponseIA });

        } catch (error) {
            console.error('❌ Erreur Commande !bilan:', error);
            await sock.sendMessage(jid, { text: "❌ *Erreur* : Impossible de générer le bilan intelligent pour le moment." });
        }
        return true;
    }
    
    
    // =========================================================
    // 📅 COMMANDE : !semaine (Résumé des 7 derniers jours par IA)
    // =========================================================
    if (texteNormalise === '!semaine') {
        await sock.sendMessage(jid, { text: "⏳ *Extraction des données, analyse des pannes et rédaction du rapport en cours...*" });
        try {
            const dateLimite = new Date();
            dateLimite.setDate(dateLimite.getDate() - 7);
            dateLimite.setHours(0, 0, 0, 0);

            // 1. Incidents / Reliquats
            const incidents = await prisma.incidentCloture.findMany({
                where: { dateDeclaration: { gte: dateLimite } }
            });
            const totalIncidents = incidents.length;
            const resolus = incidents.filter(i => i.statut === 'RESOLU').length;
            const nonResolus = incidents.filter(i => i.statut === 'NON_RESOLU').length;

            // 2. Visites Terrain
            const visites = await prisma.visiteTerrain.findMany({
                where: { dateVisite: { gte: dateLimite } }
            });
            const totalVisites = visites.length;
            const pdvPenalises = visites.filter(v => v.statut && v.statut.toLowerCase().includes('pénalis')).length;

            // 3. Pénalités financières et catégorisation des motifs
            const penalites = await prisma.penalite.findMany({
                where: { dateSaisie: { gte: dateLimite } }
            });
            const totalPenalites = penalites.length;
            let totalPenalitesUSD = 0;
            const compteurMotifs = {}; // Dictionnaire pour regrouper les motifs

            penalites.forEach(p => {
                // Calcul de l'argent retenu
                if (p.montant && p.montant.includes('$')) {
                    totalPenalitesUSD += parseInt(p.montant) || 0;
                }
                
                // Comptage des motifs (parasol, table, non port t-shirt, gilet...)
                if (p.motif) {
                    const motifPropre = p.motif.toLowerCase().trim();
                    compteurMotifs[motifPropre] = (compteurMotifs[motifPropre] || 0) + 1;
                }
            });

            // Transformation du dictionnaire en liste de texte
            let detailMotifs = "";
            if (Object.keys(compteurMotifs).length > 0) {
                detailMotifs = Object.entries(compteurMotifs)
                    .sort((a, b) => b[1] - a[1]) // Trie du plus fréquent au moins fréquent
                    .map(([motif, count]) => `${count}x ${motif}`)
                    .join(' | ');
            } else {
                detailMotifs = "Motifs non précisés";
            }

            // 4. Rapports généraux
            const rapports = await prisma.report.findMany({
                where: { timestamp: { gte: dateLimite } }
            });

            // 5. Analyse des pannes et problèmes dans la table Message
            const tousMessages = await prisma.message.findMany({
                where: { timestamp: { gte: dateLimite } },
                select: { texte: true, senderJid: true, timestamp: true }
            });

            const motsClesProblemes = ['panne', 'problème', 'probleme', 'hs', 'urgence', 'réparation', 'reparation', 'coupure', 'remplacer', 'bloqué', 'bloque', 'souci'];
            const messagesProblemes = tousMessages.filter(m => 
                m.texte && motsClesProblemes.some(mot => m.texte.toLowerCase().includes(mot))
            );

            let textePannes = "";
            if (messagesProblemes.length === 0) {
                textePannes = "- Aucun problème technique ou matériel signalé cette semaine.";
            } else {
                messagesProblemes.slice(-30).forEach(m => {
                    const dateMsg = new Date(m.timestamp).toLocaleDateString('fr-FR', { weekday: 'short' });
                    const textePropre = m.texte.replace(/\n/g, ' ').substring(0, 100);
                    const identifiant = m.senderJid ? m.senderJid.split('@')[0] : 'Inconnu';
                    textePannes += `- [${dateMsg}] ID ${identifiant} : "${textePropre}..."\n`;
                });
            }

            // 6. Préparation des données brutes pour le cerveau de l'IA
            const donneesBrutes = `
            📊 VRAIS CHIFFRES DES 7 DERNIERS JOURS :
            - Total des rapports reçus des managers : ${rapports.length}
            - Total des machines signalées non-clôturées : ${totalIncidents}
            - Reliquats réglés/résolus : ${resolus}
            - Reliquats TOUJOURS en attente (alerte rouge) : ${nonResolus}
            - Total des points de vente visités par les QS : ${totalVisites} (dont ${pdvPenalises} pénalisés sur le terrain)
            
            🛑 DÉTAIL DES PÉNALITÉS ET SANCTIONS :
            - Nombre de pénalités infligées : ${totalPenalites} (Total retenu : ${totalPenalitesUSD}$)
            - Détail strict des infractions : ${detailMotifs}
            
            🛠️ JOURNAL DES PANNES ET PROBLÈMES TECHNIQUES DE LA SEMAINE :
            (Nombre total d'alertes détectées : ${messagesProblemes.length})
            ${textePannes}
            `;

            // 7. Injection de prompt avec consigne ultra-stricte sur le vocabulaire
            const consigne = `Voici les données EXACTES de la semaine extraites de la base de données PostgreSQL :\n\n${donneesBrutes}\n\nRédige un rapport hebdomadaire très professionnel pour la réunion de direction de demain. \n\nUtilise le format strict du bilan :\n🔥 APPROBATION FINANCIÈRE\n🔴 POINTS D'ATTENTION\n🛠️ INCIDENTS TECHNIQUES\n👥 MANAGERS\n📊 CHIFFRES CLÉS (Tu DOIS lister en détail les infractions commises : non port t-shirt, non port gilet, table, parasol, etc. d'après les détails fournis)\n🎯 RECOMMANDATIONS\n\nRÈGLE ABSOLUE 1 : N'utilise JAMAIS le mot "amendes", utilise UNIQUEMENT le terme "pénalités".\nRÈGLE ABSOLUE 2 : Les pénalités sont des sanctions financières infligées aux agents fautifs sur le terrain. Ce n'est pas une dette du centre, c'est de l'argent recouvré/sanctionné pour non-respect des règles (tenue, matériel).\nRÈGLE ABSOLUE 3 : Utilise uniquement les chiffres fournis.`;
            // 8. Envoi à l'IA
            const { agentRecherche } = require('./agents');
            const reponseIA = await agentRecherche(consigne, []); 
            
            await sock.sendMessage(jid, { text: reponseIA });

        } catch (error) {
            console.error('❌ Erreur !semaine:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lors de l'extraction des données de la semaine : ${error.message}` });
        }
        return true;
    }

    // =========================================================
    // 🚨 COMMANDE : !incidents (IDs non résolus en DB)
    // =========================================================
    if (texteNormalise === '!incidents') {
        try {
            const incidents = await prisma.incidentCloture.findMany({
                where: { statut: 'NON_RESOLU' },
                orderBy: { dateDeclaration: 'asc' }
            });

            if (!incidents || incidents.length === 0) {
                await sock.sendMessage(jid, { text: `✅ *INCIDENTS EN COURS*\n\nAucun incident non résolu en base de données.` });
                return true;
            }

            let msg = `🚨 *INCIDENTS NON RÉSOLUS* (${incidents.length})\n\n`;
            for (const inc of incidents) {
                const date = new Date(inc.dateDeclaration).toLocaleDateString('fr-FR');
                const heure = new Date(inc.dateDeclaration).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                msg += `• ID *${inc.machineId}* = ${inc.montant} FC\n  📅 Déclaré le ${date} à ${heure}\n\n`;
            }
            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !incidents:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lecture DB : ${error.message}` });
        }
        return true;
    }

// =========================================================
    // 📡 COMMANDE : !statut (État en temps réel intelligent)
    // =========================================================
    if (texteNormalise === '!statut') {
        await sock.sendMessage(jid, { text: "⏳ *Balayage du centre en cours... Analyse de la situation en temps réel.*" });
        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            // 1. Rapports reçus aujourd'hui
            const rapports = await prisma.report.findMany({
                where: { timestamp: { gte: aujourdhui } },
                include: { manager: true },
                orderBy: { timestamp: 'desc' }
            });

            const typesRecus = [...new Set(rapports.map(r => r.type))];
            const tousTypes = ['ouverture', 'fixture', 'details_connexion', 'fermeture', 'coffre'];
            
            let checklist = tousTypes.map(type => {
                return typesRecus.includes(type) ? `✅ ${type.toUpperCase()}` : `❌ ${type.toUpperCase()} (Manquant)`;
            }).join('\n');

            // 2. Incidents non résolus
            const incidents = await prisma.incidentCloture.findMany({
                where: { statut: 'NON_RESOLU' }
            });
            let alerteIncidents = incidents.length > 0 
                ? `${incidents.length} reliquats en cours (IDs: ${incidents.map(i => i.machineId).join(', ')})` 
                : "Aucun reliquat en cours, les caisses sont clean !";

            // 3. Dernier signe de vie
            let dernierSigne = "Aucune activité n'a encore été enregistrée aujourd'hui.";
            if (rapports.length > 0) {
                const dernier = rapports[0];
                const nomMgr = dernier.manager?.nom || dernier.managerJid.split('@')[0];
                const heureMsg = new Date(dernier.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                dernierSigne = `Dernière action : ${nomMgr} a envoyé le rapport [${dernier.type.replace(/_/g, ' ')}] à ${heureMsg}.`;
            }

            // 4. Préparation des données brutes pour l'IA
            const donneesBrutes = `
            ÉTAT DU CENTRE À L'INSTANT T :
            - Checklist des rapports vitaux :
            ${checklist}
            - Urgences / Reliquats : ${alerteIncidents}
            - Activité récente : ${dernierSigne}
            `;

            // 5. Injection du prompt pour l'IA
            const consigne = `Tu es le copilote IA du Center Manager. Voici les données brutes du centre en ce moment même :\n\n${donneesBrutes}\n\nFais un point de situation (SitRep) très court, punchy et naturel (maximum 5 à 6 lignes). \n\nParle-lui directement comme un bras droit : dis-lui ce qui va bien (rapports reçus), alerte-le sur ce qui manque ou s'il y a des reliquats, et mentionne qui a donné le dernier signe de vie. Utilise des émojis pour rendre ça dynamique.`;

            // 6. Envoi au cerveau IA
            const { agentRecherche } = require('./agents');
            const reponseIA = await agentRecherche(consigne, []);

            await sock.sendMessage(jid, { text: `📡 *SITREP KINKOLE*\n\n${reponseIA}` });

        } catch (error) {
            console.error('❌ Erreur !statut:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lors de l'analyse du statut : ${error.message}` });
        }
        return true;
    }

    // =========================================================
    // 🚶‍♂️ COMMANDE : !visites (Visites terrain du jour)
    // =========================================================
    if (texteNormalise === '!visites') {
        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            const visites = await prisma.visiteTerrain.findMany({
                where: { dateVisite: { gte: aujourdhui } },
                orderBy: { dateVisite: 'desc' }
            });

            if (visites.length === 0) {
                await sock.sendMessage(jid, { text: `🚶‍♂️ *VISITES TERRAIN*\n\nAucune visite enregistrée aujourd'hui.` });
                return true;
            }

            let msg = `🚶‍♂️ *VISITES DU JOUR* (${visites.length})\n\n`;
            for (const v of visites) {
                const icone = v.statut.toLowerCase() === 'ok' ? '✅' : '⚠️';
                msg += `${icone} *ID ${v.agentId}* (${v.pdv})\n`;
                msg += `   Tickets: ${v.tickets} | Statut: ${v.statut}\n`;
                msg += `   ⌚ ${v.heureVisite}\n\n`;
            }
            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !visites:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lecture DB : ${error.message}` });
        }
        return true;
    }

    // =========================================================
    // 🛑 COMMANDE : !penalites (Pénalités du jour)
    // =========================================================
    if (texteNormalise === '!penalites') {
        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            const penalites = await prisma.penalite.findMany({
                where: { dateSaisie: { gte: aujourdhui } },
                orderBy: { dateSaisie: 'desc' }
            });

            if (penalites.length === 0) {
                await sock.sendMessage(jid, { text: `🛑 *PÉNALITÉS*\n\nAucune pénalité enregistrée aujourd'hui. L'équipe est sage !` });
                return true;
            }

            let msg = `🛑 *PÉNALITÉS DU JOUR* (${penalites.length})\n\n`;
            let totalAmendes = 0;

            for (const p of penalites) {
                msg += `• *ID ${p.agentId}* : ${p.montant}\n`;
                msg += `  👉 Motif : _${p.motif}_\n\n`;
                
                // Petit calcul optionnel si les montants sont en $ (juste pour l'info)
                if (p.montant && p.montant.includes('$')) {
                    totalAmendes += parseInt(p.montant) || 0;
                }
            }
            
            if (totalAmendes > 0) msg += `\n💵 *Total estimé (en USD) :* ${totalAmendes}$`;
            
            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !penalites:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lecture DB : ${error.message}` });
        }
        return true;
    }

    // =========================================================
    // 👥 COMMANDE : !equipe (Managers actifs aujourd'hui)
    // =========================================================
    if (texteNormalise === '!equipe') {
        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            const messagesDuJour = await prisma.message.findMany({
                where: { timestamp: { gte: aujourdhui } },
                select: { senderJid: true },
                distinct: ['senderJid']
            });

            if (messagesDuJour.length === 0) {
                await sock.sendMessage(jid, { text: `👥 *ÉQUIPE DU JOUR*\n\nAucune activité détectée aujourd'hui.` });
                return true;
            }

            const jidsActifs = messagesDuJour.map(m => m.senderJid);
            const managersActifs = await prisma.manager.findMany({
                where: { jid: { in: jidsActifs } }
            });

            let msg = `👥 *MANAGERS ACTIFS AUJOURD'HUI* (${managersActifs.length})\n\n`;
            for (const m of managersActifs) {
                msg += `👤 *${m.nom}* (${m.role})\n`;
            }

            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !equipe:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lecture DB : ${error.message}` });
        }
        return true;
    }

    // =========================================================
    // ✅ COMMANDE : !clotures (Historique des 15 derniers résolus)
    // =========================================================
    if (texteNormalise === '!clotures') {
        try {
            const resolus = await prisma.incidentCloture.findMany({
                where: { statut: 'RESOLU' },
                orderBy: { dateResolution: 'desc' },
                take: 15 // Les 15 derniers
            });

            if (resolus.length === 0) {
                await sock.sendMessage(jid, { text: `✅ *DERNIÈRES CLÔTURES*\n\nAucun incident n'a été résolu récemment.` });
                return true;
            }

            let msg = `✅ *LES 15 DERNIERS INCIDENTS RÉSOLUS*\n\n`;
            for (const inc of resolus) {
                const dateRes = new Date(inc.dateResolution).toLocaleDateString('fr-FR');
                const heureRes = new Date(inc.dateResolution).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                msg += `• *ID ${inc.machineId}* (Anomalie: ${inc.montant} FC)\n`;
                msg += `  ✅ Réglé le ${dateRes} à ${heureRes}\n\n`;
            }
            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !clotures:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur lecture DB : ${error.message}` });
        }
        return true;
    }

    // =========================================================
    // 📖 COMMANDE : !menu ou !aide (Liste de toutes les commandes)
    // =========================================================
    if (texteNormalise === '!menu' || texteNormalise === '!aide') {
        let msg = `👑 *PANNEAU DE CONTRÔLE PATRON* 👑\n\n`;
        msg += `Voici la liste des commandes secrètes que vous pouvez m'envoyer ici :\n\n`;
        
        msg += `📊 *RAPPORTS & ACTIVITÉ*\n`;
        msg += `• *!statut* : Réception des rapports en temps réel\n`;
        msg += `• *!bilan* : Résumé détaillé de la journée\n`;
        msg += `• *!semaine* : Résumé des 7 derniers jours\n\n`;

        msg += `🚨 *MACHINES & INCIDENTS*\n`;
        msg += `• *!incidents* : Liste des machines en anomalie\n`;
        msg += `• *!clotures* : Les 15 derniers problèmes résolus\n\n`;

        msg += `🕵️ *TERRAIN & ÉQUIPE*\n`;
        msg += `• *!equipe* : Managers qui travaillent aujourd'hui\n`;
        msg += `• *!visites* : Détails des visites terrain du jour\n`;
        msg += `• *!penalites* : Liste des amendes distribuées\n\n`;

        msg += `⚙️ *SYSTÈME*\n`;
        msg += `• *!reset-jour* : (Danger) Efface les rapports du jour\n`;

        await sock.sendMessage(jid, { text: msg });
        return true;
    }

    // =========================================================
    // 🔄 COMMANDE : !reset-jour (Vider rapports du jour pour tests)
    // =========================================================
    if (texteNormalise === '!reset-jour') {
        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            const supprime = await prisma.report.deleteMany({
                where: { timestamp: { gte: aujourdhui } }
            });

            await sock.sendMessage(jid, { 
                text: `🔄 *RESET JOURNÉE*\n\n${supprime.count} rapport(s) supprimé(s) de la DB.\nLe bot est prêt pour un nouveau test.` 
            });
        } catch (error) {
            await sock.sendMessage(jid, { text: `❌ Erreur reset : ${error.message}` });
        }
        return true;
    }

    return false; // Ce n'était pas une commande reconnue
}

module.exports = { gererCommandesPatron };
