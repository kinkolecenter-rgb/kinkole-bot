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

// ==========================================
// 📍 SAUVEGARDE DES VISITES TERRAIN (Mise à jour)
// ==========================================
async function sauvegarderVisiteTerrain(participantJid, texteBrut, typeVisite) {
    // 1. LA MAGIE : NFKC transforme "𝙏𝙞𝙘𝙠𝙚𝙩" en "Ticket" et "🆔" en "ID"
    const texteNettoye = texteBrut.normalize('NFKC').replace(/\*/g, '').replace(/_/g, '');

    // 2. Extraction ultra-tolérante (Ligne par ligne)
    const matchPdv = texteNettoye.match(/p\.?d\.?v\.?\s*[:=\-]*\s*([^\n]+)/i);
    const pdv = matchPdv ? matchPdv[1].trim() : 'Non précisé';

    const matchTickets = texteNettoye.match(/tickets?\s*[:=\-]*\s*(\d+)/i);
    const tickets = matchTickets ? parseInt(matchTickets[1], 10) : 0;

    const matchStatut = texteNettoye.match(/statuts?\s*[:=\-]*\s*([^\n]+)/i);
    const statut = matchStatut ? matchStatut[1].trim() : 'ok'; // "ok" par défaut

    const matchId = texteNettoye.match(/(?:id|🆔)\s*[:=\-]*\s*(\d{5,7})/i) || texteNettoye.match(/\b(\d{5,7})\b/);
    const agentId = matchId ? matchId[1] : 'Inconnu';

    console.log(`✅ [EXTRACTION PR] ID: ${agentId} | PDV: ${pdv} | Tickets: ${tickets} | Statut: ${statut}`);

    try {
        await prisma.visiteTerrain.create({
            data: {
                agentId: agentId,
                managerJid: participantJid, // Corrigé : participantJid au lieu de managerJid
                branche: "Kinkole",
                pdv: pdv,
                statut: statut, 
                tickets: tickets,
                heureVisite: new Date().toLocaleTimeString('fr-FR', { timeZone: 'Africa/Kinshasa' }),
                texteBrut: texteBrut
            }
        });
        console.log(`✅ Visite Terrain sauvée -> Agent: ${agentId} | PDV: ${pdv} | Statut: ${statut} | Tickets: ${tickets}`);
    } catch (error) {
        console.error("❌ Erreur DB Visite Terrain:", error.message);
    }
}

// ==========================================
// 🚨 SAUVEGARDE DES PÉNALITÉS (Filtre intelligent)
// ==========================================
async function sauvegarderPenalite(participantJid, texteBrut) {
    // 1. Nettoyage initial
    const texteNettoye = texteBrut.normalize('NFKC');

    // 2. Extraire l'ID de l'agent
    const matchId = texteNettoye.match(/\b(\d{5,7})\b/);
    const agentId = matchId ? matchId[1] : 'Inconnu';

    // 3. Extraire le montant
    const matchMontant = texteNettoye.match(/(\d+)\s*(\$|usd|fc|f)/i);
    const montant = matchMontant ? matchMontant[0].toUpperCase() : 'Non précisé';

    // 4. L'ASTUCE : Extraire le motif par "Soustraction"
    let motif = texteNettoye
        .replace(/\b(pénalité|penalite|id|branche|shop|kinkole|kinko|matete|ngaba|lemba|bibwa|victoire)\b/gi, '') 
        .replace(/\b\d{5,7}\b/g, '') 
        .replace(/\d+\s*(\$|usd|fc|f)/gi, '') 
        .replace(/[,.:*]/g, ' ') 
        .replace(/\s+/g, ' ') 
        .trim();

    if (motif.length > 0) {
        motif = motif.charAt(0).toUpperCase() + motif.slice(1);
    } else {
        motif = 'Non précisé';
    }

    console.log(`✅ [EXTRACTION PÉNALITÉ] ID: ${agentId} | Montant: ${montant} | Motif: ${motif}`);

    try {
        await prisma.penalite.create({
            data: {
                agentId: agentId,
                managerJid: participantJid, // Corrigé : participantJid
                branche: "Kinkole",
                motif: motif, // Corrigé : envoie le vrai motif au lieu de "Voir texte brut"
                montant: montant,
                texteBrut: texteBrut
            }
        });
        console.log(`✅ Pénalité sauvegardée : Agent ${agentId} | Montant ${montant} | Motif: ${motif}`);
    } catch (error) {
        console.error("❌ Erreur DB Pénalité:", error.message);
    }
}

// =================================================================
// 🏆 STATISTIQUES : TOP VISITES VIA VUE SQL
// =================================================================
async function getTopVisites() {
    try {
        const top = await prisma.top_agents_visites.findMany({
            orderBy: { total_visites: 'desc' },
            take: 5 // On prend le Top 5
        });
        return top;
    } catch (e) {
        console.error("⚠️ Erreur lecture de la vue top_agents_visites :", e.message);
        return [];
    }
}

// =================================================================
// 🎫 STATISTIQUES : TOP VENTES TICKETS VIA VUE SQL
// =================================================================
async function getTopTickets() {
    try {
        return await prisma.top_ventes_tickets.findMany({
            orderBy: { total_tickets: 'desc' },
            take: 5
        });
    } catch (e) {
        console.error("⚠️ Erreur lecture vue top_ventes_tickets :", e.message);
        return [];
    }
}

// =================================================================
// 🚨 STATISTIQUES : ALERTES TERRAIN VIA VUE SQL
// =================================================================
async function getAlertesTerrain() {
    try {
        return await prisma.alertes_terrain.findMany({
            take: 10 // On prend les 10 dernières alertes
        });
    } catch (e) {
        console.error("⚠️ Erreur lecture vue alertes_terrain :", e.message);
        return [];
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
    getTopVisites,
    getTopTickets,
    getAlertesTerrain,
    getReportsAujourdhui,
    sauvegarderIncidentCloture,
    getIncidentsNonResolus,
    marquerIncidentResolu,
    sauvegarderVisiteTerrain,
    sauvegarderPenalite
};
