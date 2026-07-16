const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ✅ Minuit heure Kinshasa (UTC+1) — évite que les rapports de la veille
// remontent entre 00h00 et 01h00 quand Railway tourne en UTC
function debutJourneeKinshasa() {
    const maintenant = new Date();
    // UTC+1 = on recule d'1h pour obtenir l'heure locale, puis on prend minuit
    const kinshasa = new Date(maintenant.getTime());
    // Kinshasa = UTC+1 → minuit Kinshasa = 23h UTC de la veille
    const offsetMs = 60 * 60 * 1000; // +1h
    const heureLocale = new Date(kinshasa.getTime() + offsetMs);
    heureLocale.setUTCHours(0, 0, 0, 0); // minuit en heure locale
    return new Date(heureLocale.getTime() - offsetMs); // retour en UTC
}

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
            data: { groupeJid, senderJid, texte, estMedia }
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
            where: { groupeJid },
            orderBy: { timestamp: 'desc' },
            take: limite
        });
    } catch (error) {
        console.error('❌ Erreur DB (getDerniersMessages):', error.message);
        return [];
    }
}

async function getMessagesNonTraites() {
    try {
        const debut = debutJourneeKinshasa();
        return await prisma.message.findMany({
            where: { est_traite: false, timestamp: { gte: debut } }
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

async function getReportsAujourdhui(typeRapport) {
    try {
        const debut = debutJourneeKinshasa();
        return await prisma.report.findMany({
            where: { type: typeRapport, timestamp: { gte: debut } }
        });
    } catch (error) {
        console.error(`⚠️ Erreur DB (getReportsAujourdhui ${typeRapport}):`, error.message);
        return [];
    }
}

async function sauvegarderIncidentCloture(machineId, montant, managerJid) {
    try {
        await upsertManager(managerJid, 'Manager Inconnu');
        return await prisma.incidentCloture.create({
            data: {
                machineId: String(machineId).trim(),
                montant: montant ? String(montant).trim() : null,
                statut: 'NON_RESOLU',
                managerJid
            }
        });
    } catch (error) {
        console.error('❌ Erreur DB (sauvegarderIncidentCloture):', error.message);
    }
}

async function getIncidentsNonResolus() {
    try {
        return await prisma.incidentCloture.findMany({
            where: { statut: 'NON_RESOLU' },
            include: { manager: true }
        });
    } catch (error) {
        console.error('❌ Erreur DB (getIncidentsNonResolus):', error.message);
        return [];
    }
}

async function marquerIncidentResolu(machineId) {
    try {
        return await prisma.incidentCloture.updateMany({
            where: { machineId: String(machineId).trim(), statut: 'NON_RESOLU' },
            data: { statut: 'RESOLU', dateResolution: new Date() }
        });
    } catch (error) {
        console.error('❌ Erreur DB (marquerIncidentResolu):', error.message);
    }
}

async function disconnect() {
    await prisma.$disconnect();
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
    sauvegarderIncidentCloture,
    getIncidentsNonResolus,
    marquerIncidentResolu
};
