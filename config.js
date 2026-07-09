module.exports = {
  port: process.env.PORT || 3000,
  monNumero: process.env.MON_NUMERO || '243904246049',
  monLid: process.env.MON_LID || '204685424214253',
  redis: {
      host: process.env.UPSTASH_REDIS_HOST,
      port: process.env.UPSTASH_REDIS_PORT || 6379,
      username: process.env.UPSTASH_REDIS_USERNAME || 'default',
      password: process.env.UPSTASH_REDIS_PASSWORD
  }
};
