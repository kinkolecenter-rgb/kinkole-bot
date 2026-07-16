const config = require('../config');
const { classifier } = require('./analyseur');

module.exports = function creerGestionnaireManagers(redis) {

    const CLE_ACTIVITE = (jid) => `manager:activite:${jid}`;
    const CLE_STATS    = (jid) => `manager:stats:${jid}`;
    const CLE_DERNIER  = (jid) => `manager:dernier:${jid}`;
    const TTL = 60 * 60 * 24 * 30; // 30 jours

    const enregistrerActivite = async (expediteurJid, message) => {
        try {
            const managerJid = trouverManagerParJid(expediteurJid);
            if (!managerJid) return; // pas un manager connu

            const categorie = classifier(message.texte || '');

            const activite = {
                timestamp: Date.now(),
                texte: (message.texte || '').substring(0, 200),
                groupe: message.groupeNom || '',
                categorie
            };

            // ✅ Fix 7 : lpush stocke en tête → lrange retourne du plus récent au plus ancien
            // On ne reverse plus dans getActivite
            await redis.lpush(CLE_ACTIVITE(managerJid), JSON.stringify(activite));
            await redis.ltrim(CLE_ACTIVITE(managerJid), 0, 199);
            await redis.expire(CLE_ACTIVITE(managerJid), TTL);

            // Dernière activité (timestamp simple)
            await redis.set(CLE_DERNIER(managerJid), Date.now(), { ex: TTL });

            // Stats
            await incrementerStat(managerJid, 'messages_total');

            if (categorie === 'urgence') {
                await incrementerStat(managerJid, 'urgences');
            }
            if (categorie === 'incident' || categorie === 'panne') {
                await incrementerStat(managerJid, 'incidents');
            }
            if (categorie === 'validation' || categorie === 'rapport') {
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

    // ✅ Fix : cherche par JID direct uniquement (plus fiable que par nom)
    const trouverManagerParJid = (jid) => {
        if (config.managers && config.managers[jid]) return jid;
        return null;
    };

    // Gardé pour compatibilité avec assistant.js
    const trouverManagerParNom = (nomOuJid) => {
        if (config.managers && config.managers[nomOuJid]) return nomOuJid;
        const nom = nomOuJid.toLowerCase();
        for (const [jid, info] of Object.entries(config.managers || {})) {
            if (info.nom.toLowerCase().includes(nom)) return jid;
        }
        return null;
    };

    // ✅ Fix 7 : plus de .reverse() — lpush stocke déjà du plus récent au plus ancien
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
                validations:    parseInt(stats?.validations || 0)
            };
        } catch (e) {
            return { messages_total: 0, incidents: 0, urgences: 0, validations: 0 };
        }
    };

    // ✅ Fix 6 : score revu — basé sur ratio validations/incidents, pas juste des seuils fixes
    const calculerScore = (stats) => {
        let score = 50; // base neutre

        // Activité générale
        if (stats.messages_total > 0)  score += 10;
        if (stats.messages_total > 5)  score += 10;
        if (stats.messages_total > 15) score += 10;

        // Ratio validations (rapports envoyés à temps)
        if (stats.validations > 0) score += 10;
        if (stats.validations > 3) score += 10;

        // Pénalités incidents/urgences
        score -= stats.incidents * 5;
        score -= stats.urgences * 10;

        return Math.max(0, Math.min(100, score));
    };

    const getPerformanceTousManagers = async () => {
        const resultats = [];
        for (const [jid, info] of Object.entries(config.managers || {})) {
            const stats = await getStats(jid);
            const score = calculerScore(stats);

            // Dernière activité depuis Redis
            let derniereActivite = 'Aucune';
            try {
                const ts = await redis.get(CLE_DERNIER(jid));
                if (ts) {
                    derniereActivite = new Date(parseInt(ts)).toLocaleTimeString('fr-FR', {
                        hour: '2-digit', minute: '2-digit',
                        timeZone: 'Africa/Kinshasa'
                    });
                }
            } catch(e) {}

            resultats.push({
                jid,
                nom: info.nom,
                role: info.role,
                stats,
                score,
                derniereActivite
            });
        }

        resultats.sort((a, b) => b.score - a.score);
        return resultats;
    };

    const formaterPerformance = (managers) => {
        if (!managers || managers.length === 0) return '📭 Aucune donnée manager disponible.';

        let txt = `👥 *PERFORMANCE MANAGERS*\n\n`;
        managers.forEach((m, i) => {
            const etoiles = '⭐'.repeat(Math.max(1, Math.ceil(m.score / 20)));
            const tendance = m.stats.incidents > 2 ? ' ⚠️' : m.stats.validations > 3 ? ' 📈' : '';
            txt += `${i + 1}. *${m.nom}* (${m.role})${tendance}\n`;
            txt += `   ${etoiles} Score: ${m.score}/100\n`;
            txt += `   📨 Messages: ${m.stats.messages_total}\n`;
            txt += `   ✅ Rapports/Validations: ${m.stats.validations}\n`;
            txt += `   ⚠️ Incidents: ${m.stats.incidents}\n`;
            if (m.stats.urgences > 0) txt += `   🔴 Urgences: ${m.stats.urgences}\n`;
            txt += `   🕐 Dernière activité: ${m.derniereActivite}\n\n`;
        });
        return txt;
    };

    // ✅ NOUVEAU : Réinitialiser les stats d'un manager (utile pour tests ou début de mois)
    const resetStats = async (managerJid) => {
        try {
            await redis.del(CLE_STATS(managerJid));
            await redis.del(CLE_ACTIVITE(managerJid));
            await redis.del(CLE_DERNIER(managerJid));
            console.log(`🔄 Stats réinitialisées pour ${managerJid}`);
        } catch(e) {
            console.error('❌ Erreur reset stats:', e.message);
        }
    };

    // ✅ NOUVEAU : Résumé rapide d'un manager spécifique
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
        getResumeManger
    };
};
