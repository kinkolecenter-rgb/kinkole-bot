module.exports = {
    port: process.env.PORT || 3000,
    monNumero: process.env.MON_NUMERO || '243904246049',
    monLid: process.env.MON_LID || '204685424214253',
    secondaireLid: '138277243904251',
    redis: {
        host: process.env.UPSTASH_REDIS_HOST,
        port: Number(process.env.UPSTASH_REDIS_PORT),
        username: process.env.UPSTASH_REDIS_USERNAME,
        password: process.env.UPSTASH_REDIS_PASSWORD
    }
};
