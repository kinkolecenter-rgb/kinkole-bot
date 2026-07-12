const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function upsertManager(jid, nom, role = 'Manager') {
    try {
        return await prisma.manager.upsert({
            where: { jid: jid },
            update: { nom: nom },
            create: { jid: jid, nom: nom, role: role }
        });
    } catch (error) {
        console.error('❌ Erreur DB (upsertManager):', error.message);
    }
}

async function sauvegarderMessage(groupeJid, senderJid, texte, estMedia = false) {
    try {
        return await prisma.message.create({
            data: {
                groupeJid,
                senderJid,
                texte,
                estMedia
                // est_traite est à "false" par défaut via le schema
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (sauvegarderMessage):', error.message);
    }
}

async function sauvegarderReport(type, contenu, managerJid, complet = true, shopId = null) {
    try {
        await upsertManager(managerJid, 'Manager Inconnu');
        return await prisma.report.create({
            data: { type, contenu, complet, managerJid, shopId }
        });
    } catch (error) {
        console.error('❌ Erreur DB (sauvegarderReport):', error.message);
    }
}

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

// ==========================================
// 🔥 NOUVELLES FONCTIONS POUR LE RATTRAPAGE
// ==========================================

async function getMessagesNonTraites() {
    try {
        const debutJournee = new Date();
        debutJournee.setHours(0, 0, 0, 0); // On prend depuis minuit aujourd'hui

        return await prisma.message.findMany({
            where: {
                est_traite: false,
                timestamp: { gte: debutJournee } 
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (getMessagesNonTraites):', error.message);
        return [];
    }
}

async function marquerMessageTraite(idMessage) {
    try {
        return await prisma.message.update({
            where: { id: idMessage },
            data: { est_traite: true }
        });
    } catch (error) {
        console.error('❌ Erreur DB (marquerMessageTraite):', error.message);
    }
}

async function disconnect() {
    await prisma.$disconnect();
}

async function getReportsAujourdhui(typeRapport) {
    try {
        const debutJournee = new Date();
        debutJournee.setHours(0, 0, 0, 0);

        return await prisma.report.findMany({
            where: {
                type: typeRapport,
                cree_le: {
                    gte: debutJournee
                }
            }
        });
    } catch (error) {
        console.error(`⚠️ Erreur lecture DB pour getReportsAujourdhui (${typeRapport}):`, error);
        return [];
    }
}

module.exports = {
    prisma,
    upsertManager,
    sauvegarderMessage,
    sauvegarderReport,
    getDerniersMessages,
    getMessagesNonTraites, // 👈 Ajouté
    marquerMessageTraite,  // 👈 Ajouté
    disconnect,
    getReportsAujourdhui
};
