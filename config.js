module.exports = {
    port: process.env.PORT || 3000,

    monNumero: process.env.MON_NUMERO || '243904246049',
    monLid: process.env.MON_LID || '204685424214253',
    redis: {
        host: process.env.UPSTASH_REDIS_HOST,
        port: Number(process.env.UPSTASH_REDIS_PORT),
        username: process.env.UPSTASH_REDIS_USERNAME,
        password: process.env.UPSTASH_REDIS_PASSWORD
    },

    groupes: {
        gestion_center: "120363027433348642@g.us",
        s_check: "243900435187-1560795042@g.us",
        rate_fixture: "243890177777-1574181414@g.us"
    }
};
