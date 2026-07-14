const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const config = require('../config');

/**
 * Gère les commandes secrètes envoyées par le patron en privé
 */
async function gererCommandesPatron(sock, jid, texteBrut) {
    // 1. SÉCURITÉ : Vérifier si le message vient de TOI
    const numeroPatron = `${config.monNumero}@s.whatsapp.net`;
    //if (jid !== numeroPatron) return false; // Si ce n'est pas toi, on ignore

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

    return false; // Ce n'était pas une commande reconnue
}

module.exports = { gererCommandesPatron };
