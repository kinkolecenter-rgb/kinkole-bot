const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

module.exports = async (redisClient, sessionId = 'session') => {

    const write = async (data, key) => {
        try {
            await redisClient.set(`${sessionId}:${key}`, JSON.stringify(data, BufferJSON.replacer));
        } catch (e) {
            console.error(`❌ Redis write error [${key}]:`, e);
        }
    };

    const read = async (key) => {
        try {
            const data = await redisClient.get(`${sessionId}:${key}`);
            return data ? JSON.parse(data, BufferJSON.reviver) : null;
        } catch (e) {
            return null;
        }
    };

    const remove = async (key) => {
        try { await redisClient.del(`${sessionId}:${key}`); } catch (e) {}
    };

    const creds = (await read('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = await read(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            value
                                ? await write(value, `${category}-${id}`)
                                : await remove(`${category}-${id}`);
                        }
                    }
                }
            }
        },
        saveCreds: () => write(creds, 'creds')
    };
};
