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
    // 📊 COMMANDE : !bilan (Traçage exact des Collaborateurs VIP)
    // =========================================================
    if (texteNormalise === '!bilan') {
        await sock.sendMessage(jid, { text: "⏳ *Génération du Bilan VIP en cours...*" });

        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            // 1. Ta liste stricte de collaborateurs VIP à surveiller
            const listeManagersVIP = {
                '178499008630811@lid': { nom: 'Collaborateur 1', role: 'Manager' },
                '90263603159168@lid':  { nom: 'Collaborateur 2', role: 'Manager' },
                '42967356150013@lid':  { nom: 'Collaborateur 3', role: 'Ass. Manager' },
                '265029714768018@lid': { nom: 'Collaborateur 4', role: 'Ass. Manager' },
                '152059408036054@lid': { nom: 'Collaborateur 5', role: 'Manager' },
                '169230989307948@lid': { nom: 'Collaborateur 6', role: 'Manager' },
                '265515029283001@lid': { nom: 'Collaborateur 7', role: 'Ass. Manager' }
            };

            // 2. Dictionnaire exhaustif de tes 15 groupes surveillés
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

            // 3. On récupère TOUS les messages envoyés par CES LIDs aujourd'hui, dans TOUS les groupes
            const messagesVIP = await prisma.message.findMany({
                where: {
                    timestamp: { gte: aujourdhui },
                    senderJid: { in: jidsVIP }
                },
                orderBy: { timestamp: 'asc' }
            });

            if (messagesVIP.length === 0) {
                await sock.sendMessage(jid, { text: "📊 *BILAN DES COLLABORATEURS VIP*\n\nAucune activité détectée pour ces managers aujourd'hui." });
                return true;
            }

            // 4. On construit le message WhatsApp
            let messageBilan = `📊 *BILAN DES COLLABORATEURS VIP* (${new Date().toLocaleDateString('fr-FR')})\n\n`;

            for (const [lid, infos] of Object.entries(listeManagersVIP)) {
                // On filtre les messages de ce manager spécifique
                const msgsDuManager = messagesVIP.filter(m => m.senderJid === lid);
                
                if (msgsDuManager.length > 0) {
                    messageBilan += `👤 *${infos.nom}* :\n`;
                    
                    for (const m of msgsDuManager) {
                        // On trouve le nom du groupe (ou on garde "un groupe" si l'ID n'est pas dans le dictionnaire)
                        let nomGroupe = groupesConnus[m.groupeJid] || 'un groupe';

                        // On prend la première ligne du message pour faire un résumé propre
                        let apercu = "Média / Image / Audio";
                        if (m.texte) {
                            // Trouve la première ligne qui n'est pas vide
                            const lignes = m.texte.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                            if (lignes.length > 0) {
                                // Coupe à 45 caractères pour ne pas faire un message kilométrique
                                apercu = lignes[0].length > 45 ? lignes[0].substring(0, 45) + '...' : lignes[0];
                            }
                        }

                        // Format final : ▪️ dans Composition : compo shift1
                        messageBilan += `  ▪️ dans *${nomGroupe}* : _${apercu}_\n`;
                    }
                    messageBilan += `\n`;
                }
            }

            // On envoie le résultat final au Boss
            await sock.sendMessage(jid, { text: messageBilan });

        } catch (error) {
            console.error('❌ Erreur Commande !bilan:', error);
            await sock.sendMessage(jid, { text: "❌ *Erreur* : Impossible de générer le bilan pour le moment." });
        }
        return true;
    }
    // =========================================================
    // 📅 COMMANDE : !semaine (Résumé des 7 derniers jours)
    // =========================================================
    if (texteNormalise === '!semaine') {
        await sock.sendMessage(jid, { text: "⏳ *Génération du Bilan Hebdomadaire...*" });
        try {
            const il7Jours = new Date();
            il7Jours.setDate(il7Jours.getDate() - 7);
            il7Jours.setHours(0, 0, 0, 0);

            const rapports = await prisma.report.findMany({
                where: { timestamp: { gte: il7Jours } },
                include: { manager: true },
                orderBy: { timestamp: 'asc' }
            });

            if (rapports.length === 0) {
                await sock.sendMessage(jid, { text: `📅 *BILAN HEBDOMADAIRE*\n\nAucun rapport sur les 7 derniers jours.` });
                return true;
            }

            // Grouper par jour
            const parJour = {};
            for (const r of rapports) {
                const jour = new Date(r.timestamp).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                if (!parJour[jour]) parJour[jour] = {};
                const type = r.type.replace(/_/g, ' ').toUpperCase();
                parJour[jour][type] = (parJour[jour][type] || 0) + 1;
            }

            // Incidents non résolus de la semaine
            const incidents = await prisma.incidentCloture.findMany({
                where: { dateDeclaration: { gte: il7Jours } }
            });
            const nonResolus = incidents.filter(i => i.statut === 'NON_RESOLU').length;
            const resolus = incidents.filter(i => i.statut === 'RESOLU').length;

            let msg = `📅 *BILAN HEBDOMADAIRE*\n_7 derniers jours_\n\n`;
            for (const [jour, types] of Object.entries(parJour)) {
                msg += `📆 *${jour}*\n`;
                for (const [type, count] of Object.entries(types)) {
                    msg += `  ▪️ ${type} (x${count})\n`;
                }
                msg += '\n';
            }
            msg += `─────────────────\n`;
            msg += `📊 *Total rapports :* ${rapports.length}\n`;
            msg += `🚨 *Incidents déclarés :* ${incidents.length} (${resolus} résolus, ${nonResolus} en cours)`;

            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !semaine:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur : ${error.message}` });
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
    // 📡 COMMANDE : !statut (État en temps réel)
    // =========================================================
    if (texteNormalise === '!statut') {
        try {
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);

            const rapports = await prisma.report.findMany({
                where: { timestamp: { gte: aujourdhui } },
                include: { manager: true },
                orderBy: { timestamp: 'desc' }
            });

            const incidents = await prisma.incidentCloture.findMany({
                where: { statut: 'NON_RESOLU' }
            });

            const typesRecus = [...new Set(rapports.map(r => r.type))];
            const tousTypes = ['ouverture', 'fixture', 'details_connexion', 'fermeture', 'coffre'];

            const heure = new Date().getHours();
            let msg = `📡 *STATUT EN TEMPS RÉEL*\n_${new Date().toLocaleString('fr-FR')}_\n\n`;

            msg += `📋 *Rapports du jour :*\n`;
            for (const type of tousTypes) {
                const recu = typesRecus.includes(type);
                const nomJoli = type.replace(/_/g, ' ').toUpperCase();
                msg += recu ? `✅ ${nomJoli}\n` : `❌ ${nomJoli}\n`;
            }

            msg += `\n🚨 *Incidents non résolus :* ${incidents.length === 0 ? 'Aucun ✅' : incidents.length + ' en cours ⚠️'}\n`;

            if (incidents.length > 0) {
                msg += incidents.map(i => `  • ID ${i.machineId} = ${i.montant} FC`).join('\n') + '\n';
            }

            if (rapports.length > 0) {
                const dernier = rapports[0];
                const nomMgr = dernier.manager?.nom || 'Inconnu';
                const heureMsg = new Date(dernier.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                msg += `\n⏱️ *Dernier rapport :* ${dernier.type.replace(/_/g, ' ')} par *${nomMgr}* à ${heureMsg}`;
            }

            await sock.sendMessage(jid, { text: msg });
        } catch (error) {
            console.error('❌ Erreur !statut:', error);
            await sock.sendMessage(jid, { text: `❌ Erreur : ${error.message}` });
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
