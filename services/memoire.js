const config = require('../config');

const CLE_MESSAGES = (groupeJid) => `messages:${groupeJid}`;
const MAX_MESSAGES = 200; // max par groupe

module.exports = function creerMemoire(redis) {

    const sauvegarderMessage = async (groupeJid, message) => {
        try {
            const cle = CLE_MESSAGES(groupeJid);
            const data = JSON.stringify(message);
            await redis.lpush(cle, data);
            await redis.ltrim(cle, 0, MAX_MESSAGES - 1);
            await redis.expire(cle, 60 * 60 * 24 * 7); // 7 jours
        } catch (e) {
            console.error('❌ Erreur sauvegarde message:', e.message);
        }
    };

    const getMessages = async (groupeJid, limit = 50) => {
        try {
            const cle = CLE_MESSAGES(groupeJid);
            const data = await redis.lrange(cle, 0, limit - 1);
            return data.map(d => JSON.parse(d)).reverse();
        } catch (e) {
            console.error('❌ Erreur lecture messages:', e.message);
            return [];
        }
    };

    const getTousMessages = async (limit = 50) => {
        try {
            const tous = [];
            for (const jid of config.groupesSurveilles) {
                const msgs = await getMessages(jid, limit);
                tous.push(...msgs);
            }
            tous.sort((a, b) => a.timestamp - b.timestamp);
            return tous;
        } catch (e) {
            console.error('❌ Erreur lecture tous messages:', e.message);
            return [];
        }
    };

    const getMessagesDepuis = async (heures = 3) => {
        try {
            const depuis = Date.now() - (heures * 60 * 60 * 1000);
            const tous = await getTousMessages(100);
            return tous.filter(m => m.timestamp >= depuis);
        } catch (e) {
            return [];
        }
    };

    const viderGroupe = async (groupeJid) => {
        try {
            await redis.del(CLE_MESSAGES(groupeJid));
        } catch (e) {}
    };

    return {
        sauvegarderMessage,
        getMessages,
        getTousMessages,
        getMessagesDepuis,
        viderGroupe
    };
};
