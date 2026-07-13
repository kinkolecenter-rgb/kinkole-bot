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
                timestamp: {
                    gte: debutJournee
                }
            }
        });
    } catch (error) {
        console.error(`⚠️ Erreur lecture DB pour getReportsAujourdhui (${typeRapport}):`, error);
        return [];
    }
}

// ==========================================
// 🚨 SUIVI DES INCIDENTS (NON-CLÔTURÉS)
// ==========================================

async function sauvegarderIncidentCloture(machineId, montant, managerJid) {
    try {
        await upsertManager(managerJid, 'Manager Inconnu');
        return await prisma.incidentCloture.create({
            data: {
                machineId: String(machineId).trim(),
                montant: montant ? String(montant).trim() : null,
                statut: "NON_RESOLU",
                managerJid: managerJid
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (sauvegarderIncidentCloture):', error.message);
    }
}

async function getIncidentsNonResolus() {
    try {
        return await prisma.incidentCloture.findMany({
            where: { statut: "NON_RESOLU" },
            include: { manager: true } // Permet de savoir quel manager a le problème
        });
    } catch (error) {
        console.error('❌ Erreur DB (getIncidentsNonResolus):', error.message);
        return [];
    }
}

async function marquerIncidentResolu(machineId) {
    try {
        // On met à jour toutes les entrées "NON_RESOLU" correspondant à cet ID
        return await prisma.incidentCloture.updateMany({
            where: { 
                machineId: String(machineId).trim(),
                statut: "NON_RESOLU" 
            },
            data: { 
                statut: "RESOLU",
                dateResolution: new Date()
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (marquerIncidentResolu):', error.message);
    }
}

module.exports = {
    prisma,
    upsertManager,
    sauvegarderMessage,
    sauvegarderReport,
    getDerniersMessages,
    getMessagesNonTraites,
    marquerMessageTraite,
    disconnect,
    getReportsAujourdhui,
    // 👇 Les 3 nouvelles fonctions ajoutées ici :
    sauvegarderIncidentCloture,
    getIncidentsNonResolus,
    marquerIncidentResolu
};
