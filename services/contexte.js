const config = require('../config');

module.exports = function creerContexte(redis) {

    const CLE_HISTORIQUE = (jid) => `conversation:${jid}`;
    const MAX_HISTORIQUE = 10;
    const TTL = 60 * 60 * 24; // 24h

    const ajouterEchange = async (jid, role, contenu) => {
        try {
            const cle = CLE_HISTORIQUE(jid);
            const echange = JSON.stringify({ role, content: contenu, timestamp: Date.now() });
            await redis.rpush(cle, echange);
            await redis.ltrim(cle, -MAX_HISTORIQUE * 2, -1);
            await redis.expire(cle, TTL);
        } catch (e) {
            console.error('❌ Erreur contexte:', e.message);
        }
    };

    const getHistorique = async (jid) => {
        try {
            const cle = CLE_HISTORIQUE(jid);
            const data = await redis.lrange(cle, 0, -1);
            return data.map(d => {
                const parsed = JSON.parse(d);
                return { role: parsed.role, content: parsed.content };
            });
        } catch (e) {
            return [];
        }
    };

    const viderHistorique = async (jid) => {
        try {
            await redis.del(CLE_HISTORIQUE(jid));
        } catch (e) {}
    };

    return { ajouterEchange, getHistorique, viderHistorique };
};
