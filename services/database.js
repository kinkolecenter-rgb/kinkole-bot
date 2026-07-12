const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Enregistre ou met à jour un manager dans la base de données.
 */
async function upsertManager(jid, nom, role = 'Manager') {
    try {
        return await prisma.manager.upsert({
            where: { jid: jid },
            update: { nom: nom }, // Met à jour le nom si déjà existant
            create: { jid: jid, nom: nom, role: role }
        });
    } catch (error) {
        console.error('❌ Erreur DB (upsertManager):', error.message);
    }
}

/**
 * Sauvegarde un message brut entrant.
 */
async function sauvegarderMessage(groupeJid, senderJid, texte, estMedia = false) {
    try {
        return await prisma.message.create({
            data: {
                groupeJid,
                senderJid,
                texte,
                estMedia
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (sauvegarderMessage):', error.message);
    }
}

/**
 * Sauvegarde un rapport structuré.
 */
async function sauvegarderReport(type, contenu, managerJid, complet = true, shopId = null) {
    try {
        // S'assurer que le manager existe avant de lier le rapport
        await upsertManager(managerJid, 'Manager Inconnu');

        return await prisma.report.create({
            data: {
                type,
                contenu, // Objet JSON (ex: { heure: "08:00", caisse: 500 })
                complet,
                managerJid,
                shopId
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (sauvegarderReport):', error.message);
    }
}

/**
 * Récupère les derniers messages d'un groupe spécifique.
 */
async function getDerniersMessages(groupeJid, limite = 50) {
    try {
        return await prisma.message.findMany({
            where: { groupeJid: groupeJid },
            orderBy: { timestamp: 'desc' },
            take: limite
        });
    } catch (error) {
        console.error('❌ Erreur DB (getDerniersMessages):', error.message);
        return [];
    }
}

/**
 * Ferme proprement la connexion à la base de données.
 */
async function disconnect() {
    await prisma.$disconnect();
}

module.exports = {
    prisma,
    upsertManager,
    sauvegarderMessage,
    sauvegarderReport,
    getDerniersMessages,
    disconnect,
    supabase // 👈 AJOUTE JUSTE CE MOT ICI !
};
