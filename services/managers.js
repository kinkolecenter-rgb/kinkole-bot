const config = require('../config');

module.exports = function creerGestionnaireManagers(redis) {

    const CLE_ACTIVITE = (jid) => `manager:activite:${jid}`;
    const CLE_STATS = (jid) => `manager:stats:${jid}`;
    const TTL = 60 * 60 * 24 * 30; // 30 jours

    const enregistrerActivite = async (expediteurJid, message) => {
        try {
            // Trouver le manager par JID ou nom
            const managerJid = trouverManagerParNom(expediteurJid) || expediteurJid;
            const info = config.managers[managerJid];
            if (!info) return; // pas un manager connu

            const activite = {
                timestamp: Date.now(),
                texte: message.texte,
                groupe: message.groupeNom,
                categorie: message.categorie || 'information'
            };

            await redis.lpush(CLE_ACTIVITE(managerJid), JSON.stringify(activite));
            await redis.ltrim(CLE_ACTIVITE(managerJid), 0, 199);
            await redis.expire(CLE_ACTIVITE(managerJid), TTL);

            // Mettre à jour stats
            await incrementerStat(managerJid, 'messages_total');
            if (activite.categorie === 'urgence' || activite.categorie === 'incident') {
                await incrementerStat(managerJid, 'incidents');
            }
            if (activite.categorie === 'validation') {
                await incrementerStat(managerJid, 'validations');
            }

        } catch (e) {
            console.error('❌ Erreur enregistrement manager:', e.message);
        }
    };

    const incrementerStat = async (managerJid, stat) => {
        try {
            const cle = CLE_STATS(managerJid);
            await redis.hincrby(cle, stat, 1);
            await redis.expire(cle, TTL);
        } catch (e) {}
    };

    const trouverManagerParNom = (nomOuJid) => {
        // Cherche par JID direct
        if (config.managers[nomOuJid]) return nomOuJid;

        // Cherche par nom dans le texte
        const nom = nomOuJid.toLowerCase();
        for (const [jid, info] of Object.entries(config.managers)) {
            if (info.nom.toLowerCase().includes(nom)) return jid;
        }
        return null;
    };

    const getActivite = async (managerJid, limit = 20) => {
        try {
            const data = await redis.lrange(CLE_ACTIVITE(managerJid), 0, limit - 1);
            return data.map(d => JSON.parse(d)).reverse();
        } catch (e) {
            return [];
        }
    };

    const getStats = async (managerJid) => {
        try {
            const stats = await redis.hgetall(CLE_STATS(managerJid));
            return {
                messages_total: parseInt(stats?.messages_total || 0),
                incidents: parseInt(stats?.incidents || 0),
                validations: parseInt(stats?.validations || 0)
            };
        } catch (e) {
            return { messages_total: 0, incidents: 0, validations: 0 };
        }
    };

    const getPerformanceTousManagers = async () => {
        const resultats = [];
        for (const [jid, info] of Object.entries(config.managers)) {
            const stats = await getStats(jid);
            const activite = await getActivite(jid, 50);

            // Calcul score simple
            let score = 0;
            if (stats.messages_total > 0) score += 30;
            if (stats.messages_total > 10) score += 20;
            if (stats.validations > 0) score += 20;
            if (stats.incidents < 3) score += 30;
            if (stats.incidents >= 3) score -= 10;

            // Dernière activité
            const dernierMsg = activite[activite.length - 1];
            const derniereActivite = dernierMsg
                ? new Date(dernierMsg.timestamp).toLocaleTimeString('fr-FR')
                : 'Aucune';

            resultats.push({
                jid,
                nom: info.nom,
                role: info.role,
                stats,
                score: Math.max(0, Math.min(100, score)),
                derniereActivite
            });
        }

        resultats.sort((a, b) => b.score - a.score);
        return resultats;
    };

    const formaterPerformance = (managers) => {
        if (managers.length === 0) return '📭 Aucune donnée manager disponible.';

        let txt = `👥 *PERFORMANCE MANAGERS*\n\n`;
        managers.forEach((m, i) => {
            const etoiles = '⭐'.repeat(Math.ceil(m.score / 20));
            txt += `${i + 1}. *${m.nom}* (${m.role})\n`;
            txt += `   ${etoiles} Score: ${m.score}/100\n`;
            txt += `   📨 Messages: ${m.stats.messages_total}\n`;
            txt += `   ✅ Validations: ${m.stats.validations}\n`;
            txt += `   ⚠️ Incidents: ${m.stats.incidents}\n`;
            txt += `   🕐 Dernière activité: ${m.derniereActivite}\n\n`;
        });
        return txt;
    };

    return {
        enregistrerActivite,
        getActivite,
        getStats,
        getPerformanceTousManagers,
        formaterPerformance,
        trouverManagerParNom
    };
};
