const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const config = require('../config');

/**
 * Gère les commandes secrètes envoyées par le patron en privé
 */
async function gererCommandesPatron(sock, jid, texteBrut) {
    // 1. SÉCURITÉ : Vérifie si l'ID contient ton numéro (pour contourner les :xx de WhatsApp)
    const vientDuPatron = jid.includes(config.monNumero) || jid.includes(config.secondaireNumero);
    if (!vientDuPatron) return false;

    const texteNormalise = texteBrut.trim().toLowerCase();

    // =========================================================
    // 📊 COMMANDE : !bilan (Résumé de la journée)
    // =========================================================
    if (texteNormalise === '!bilan') {
        await sock.sendMessage(jid, { text: "⏳ *Génération du Bilan Journalier en cours...*" });

        try {
            // On définit la plage d'aujourd'hui (de minuit à maintenant)
            const aujourdhui = new Date();
            aujourdhui.setHours(0, 0, 0, 0);
            
            // On récupère tous les rapports du jour
            const rapportsDuJour = await prisma.report.findMany({
                where: { timestamp: { gte: aujourdhui } },
                include: { manager: true } // On inclut les infos du manager
            });

            if (rapportsDuJour.length === 0) {
                await sock.sendMessage(jid, { text: "📊 *BILAN DU JOUR*\n\nLe calme plat. Aucun rapport n'a été reçu aujourd'hui." });
                return true;
            }

            // On trie les rapports par Manager
            const rapportsParManager = {};
            for (const r of rapportsDuJour) {
                const nomManager = r.manager ? r.manager.nom : 'Manager Inconnu';
                if (!rapportsParManager[nomManager]) {
                    rapportsParManager[nomManager] = [];
                }
                rapportsParManager[nomManager].push(r.type);
            }

            // On construit le beau message WhatsApp
            let messageBilan = `📊 *BILAN DU JOUR* (${new Date().toLocaleDateString()})\n\n`;
            
            for (const [nom, types] of Object.entries(rapportsParManager)) {
                messageBilan += `👤 *${nom}* a envoyé :\n`;
                
                // On compte combien de fois chaque rapport a été envoyé (ex: 3x details_connexion)
                const compteTypes = {};
                types.forEach(t => compteTypes[t] = (compteTypes[t] || 0) + 1);
                
                for (const [type, count] of Object.entries(compteTypes)) {
                    // On rend le texte plus joli (enlève les tirets du bas)
                    const nomJoli = type.replace(/_/g, ' ').toUpperCase();
                    messageBilan += `   ▪️ ${nomJoli} (x${count})\n`;
                }
                messageBilan += `\n`;
            }

            // On envoie le résultat final
            await sock.sendMessage(jid, { text: messageBilan });

        } catch (error) {
            console.error('❌ Erreur Commande !bilan:', error);
            await sock.sendMessage(jid, { text: "❌ *Erreur* : Impossible de générer le bilan pour le moment." });
        }
        return true; // Commande traitée avec succès
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
