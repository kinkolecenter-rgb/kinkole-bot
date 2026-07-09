const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

module.exports = async (redisClient, sessionId = 'session') => {
    const writeData = async (data, key) => {
        try {
            await redisClient.set(`${sessionId}:${key}`, JSON.stringify(data, BufferJSON.replacer));
        } catch (error) { console.error(`❌ Erreur d'écriture Redis [${key}]:`, error); }
    };

    const readData = async (key) => {
        try {
            const data = await redisClient.get(`${sessionId}:${key}`);
            return data ? JSON.parse(data, BufferJSON.reviver) : null;
        } catch (error) { return null; }
    };

    const removeData = async (key) => {
        try { await redisClient.del(`${sessionId}:${key}`); } catch (error) {}
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) tasks.push(writeData(value, key));
                            else tasks.push(removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};