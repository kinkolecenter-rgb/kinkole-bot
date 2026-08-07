const config = require('../config');
const { classifier } = require('./analyseur');

module.exports = function creerGestionnaireManagers(redis) {

    const CLE_ACTIVITE = (jid) => `manager:activite:${jid}`;
    const CLE_STATS    = (jid) => `manager:stats:${jid}`;
    const CLE_DERNIER  = (jid) => `manager:dernier:${jid}`;
    const TTL = 60 * 60 * 24 * 30; // 30 jours

    const trouverManagerParJid = (jid) => {
        if (config.managers && config.managers[jid]) return jid;
        return null;
    };

    const trouverManagerParNom = (nomOuJid) => {
        if (config.managers && config.managers[nomOuJid]) return nomOuJid;
        const nom = nomOuJid.toLowerCase();
        for (const [jid, info] of Object.entries(config.managers || {})) {
            if (info.nom.toLowerCase().includes(nom)) return jid;
        }
        return null;
    };

    const incrementerStat = async (managerJid, stat) => {
        try {
            const cle = CLE_STATS(managerJid);
            await redis.hincrby(cle, stat, 1);
            await redis.expire(cle, TTL);
        } catch (e) {}
    };

    // ==========================================
    // 🏆 NOUVEAU : SYSTÈME DE RÉCOMPENSES ET PÉNALITÉS
    // ==========================================
    
    // Appelée par l'Oeil de Lynx, le Gatekeeper, ou la Tour de Contrôle
    const penaliserManager = async (managerJid, typeFaute) => {
        // Types acceptés : 'retards', 'media_manquant', 'absences_injustifiees', 'decisions_non_autorisees'
        await incrementerStat(managerJid, typeFaute);
        console.log(`📉 Pénalité (${typeFaute}) appliquée au manager : ${managerJid}`);
    };

    const recompenserManager = async (managerJid, typeBonus) => {
        // Types acceptés : 'rapports_ponctuels', 'clotures_parfaites'
        await incrementerStat(managerJid, typeBonus);
        console.log(`📈 Bonus (${typeBonus}) accordé au manager : ${managerJid}`);
    };

    // ==========================================

    const enregistrerActivite = async (expediteurJid, message) => {
        try {
            const managerJid = trouverManagerParJid(expediteurJid);
            if (!managerJid) return;

            const categorie = classifier(message.texte || '');

            const activite = {
                timestamp: Date.now(),
                texte: (message.texte || '').substring(0, 200),
                groupe: message.groupeNom || '',
                categorie
            };

            await redis.lpush(CLE_ACTIVITE(managerJid), JSON.stringify(activite));
            await redis.ltrim(CLE_ACTIVITE(managerJid), 0, 199);
            await redis.expire(CLE_ACTIVITE(managerJid), TTL);

            await redis.set(CLE_DERNIER(managerJid), Date.now(), 'EX', TTL);
            await incrementerStat(managerJid, 'messages_total');

            if (categorie === 'urgence') await incrementerStat(managerJid, 'urgences');
            if (categorie === 'incident' || categorie === 'panne') await incrementerStat(managerJid, 'incidents');
            if (categorie === 'validation' || categorie === 'rapport') await incrementerStat(managerJid, 'validations');

        } catch (e) {
            console.error('❌ Erreur enregistrement manager:', e.message);
        }
    };

    const getActivite = async (managerJid, limit = 20) => {
        try {
            const data = await redis.lrange(CLE_ACTIVITE(managerJid), 0, limit - 1);
            return data.map(d => {
                try { return JSON.parse(d); } catch(e) { return null; }
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    };

    const getStats = async (managerJid) => {
        try {
            const stats = await redis.hgetall(CLE_STATS(managerJid));
            return {
                messages_total: parseInt(stats?.messages_total || 0),
                incidents:      parseInt(stats?.incidents || 0),
                urgences:       parseInt(stats?.urgences || 0),
                validations:    parseInt(stats?.validations || 0),
                
                // Nouveaux compteurs de performance
                retards:                  parseInt(stats?.retards || 0),
                media_manquant:           parseInt(stats?.media_manquant || 0),
                absences_injustifiees:    parseInt(stats?.absences_injustifiees || 0),
                decisions_non_autorisees: parseInt(stats?.decisions_non_autorisees || 0),
                rapports_ponctuels:       parseInt(stats?.rapports_ponctuels || 0),
                clotures_parfaites:       parseInt(stats?.clotures_parfaites || 0)
            };
        } catch (e) {
            return { 
                messages_total: 0, incidents: 0, urgences: 0, validations: 0,
                retards: 0, media_manquant: 0, absences_injustifiees: 0, decisions_non_autorisees: 0, rapports_ponctuels: 0, clotures_parfaites: 0
            };
        }
    };

    // 🏆 Le nouveau cerveau de notation (Base 100)
    const calculerScore = (stats) => {
        let score = 100; // Base de départ (Perfection)

        // Ajout des bonus
        score += (stats.rapports_ponctuels * 10);
        score += (stats.clotures_parfaites * 5);

        // Retrait des pénalités (Malus stricts)
        score -= (stats.retards * 5);
        score -= (stats.media_manquant * 5);
        score -= (stats.absences_injustifiees * 10);
        score -= (stats.decisions_non_autorisees * 15);

        // Ne pas descendre en dessous de 0
        return Math.max(0, score);
    };

    const getPerformanceTousManagers = async () => {
        const resultats = [];
        for (const [jid, info] of Object.entries(config.managers || {})) {
            const stats = await getStats(jid);
            const score = calculerScore(stats);

            let derniereActivite = 'Aucune';
            try {
                const ts = await redis.get(CLE_DERNIER(jid));
                if (ts) {
                    derniereActivite = new Date(parseInt(ts)).toLocaleTimeString('fr-FR', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa'
                    });
                }
            } catch(e) {}

            resultats.push({ jid, nom: info.nom, role: info.role, stats, score, derniereActivite });
        }

        resultats.sort((a, b) => b.score - a.score);
        return resultats;
    };

    // 🎨 Le nouveau tableau de bord stylisé
    const formaterPerformance = (managers) => {
        if (!managers || managers.length === 0) return '📭 Aucune donnée manager disponible.';

        let txt = `🏆 *CLASSEMENT DE PERFORMANCE* 🏆\n_Score de base : 100 pts_\n\n`;
        
        managers.forEach((m, i) => {
            let medaille = '🏅';
            if (i === 0) medaille = '🥇';
            if (i === 1) medaille = '🥈';
            if (i === 2) medaille = '🥉';
            
            let appreciation = "Critique ⚠️";
            if (m.score >= 100) appreciation = "Excellent 🌟";
            else if (m.score >= 80) appreciation = "Bon 🟢";
            else if (m.score >= 50) appreciation = "Moyen 🟡";

            txt += `${medaille} *${m.nom}* — *${m.score} pts* (${appreciation})\n`;
            
            // Affichage des fautes si le manager en a commis
            const totalFautes = m.stats.retards + m.stats.media_manquant + m.stats.absences_injustifiees + m.stats.decisions_non_autorisees;
            if (totalFautes > 0) {
                txt += `   🔻 *Pénalités :*\n`;
                if (m.stats.retards > 0) txt += `      • ${m.stats.retards} Retard(s)\n`;
                if (m.stats.media_manquant > 0) txt += `      • ${m.stats.media_manquant} Média(s) manquant(s)\n`;
                if (m.stats.absences_injustifiees > 0) txt += `      • ${m.stats.absences_injustifiees} Absence(s) injustifiée(s)\n`;
                if (m.stats.decisions_non_autorisees > 0) txt += `      • ${m.stats.decisions_non_autorisees} Décision(s) non autorisée(s)\n`;
            }
            txt += `   🕐 _Dernière action: ${m.derniereActivite}_\n\n`;
        });
        return txt;
    };

    const resetStats = async (managerJid) => {
        try {
            await redis.del(CLE_STATS(managerJid));
            await redis.del(CLE_ACTIVITE(managerJid));
            await redis.del(CLE_DERNIER(managerJid));
            console.log(`🔄 Stats réinitialisées pour ${managerJid}`);
        } catch(e) {}
    };

    const getResumeManger = async (managerJid) => {
        const info = config.managers?.[managerJid];
        if (!info) return null;
        const stats = await getStats(managerJid);
        const activite = await getActivite(managerJid, 5);
        const score = calculerScore(stats);
        return { jid: managerJid, nom: info.nom, role: info.role, stats, score, activite };
    };

    return {
        enregistrerActivite,
        getActivite,
        getStats,
        getPerformanceTousManagers,
        formaterPerformance,
        trouverManagerParNom,
        trouverManagerParJid,
        resetStats,
        getResumeManger,
        penaliserManager,   // <-- Exporté pour être utilisé ailleurs
        recompenserManager  // <-- Exporté pour être utilisé ailleurs
    };
};
