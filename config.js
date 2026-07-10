module.exports = {
    port: process.env.PORT || 3000,
    monNumero: process.env.MON_NUMERO || '243904246049',
    monLid: process.env.MON_LID || '204685424214253',
    secondaireLid: '138277243904251',
    groqApiKey: process.env.GROQ_API_KEY,
    redis: {
        host: process.env.UPSTASH_REDIS_HOST,
        port: Number(process.env.UPSTASH_REDIS_PORT),
        username: process.env.UPSTASH_REDIS_USERNAME,
        password: process.env.UPSTASH_REDIS_PASSWORD
    },
    groupesSurveilles: [
        '120363021280044937@g.us',
        '120363023010071105@g.us',
        '120363025487823123@g.us',
        '120363040045715280@g.us',
        '243907634105-1540987363@g.us',
        '243900435187-1521782366@g.us',
        '243900435187-1564931206@g.us',
        '243890011696-1509543437@g.us',
        '120363039964661142@g.us',
        '243900435187-1560664753@g.us',
        '243900435187-1543596785@g.us',
        '120363024619387743@g.us',
        '243900435187-1564716535@g.us',
        '120363049897392666@g.us'
    ],
    groupesDestination: {
        gestion_center: { nom: 'Gestion Centers📢', id: '120363027433348642@g.us' },
        s_check:        { nom: 'S.check bn',        id: '243900435187-1560795042@g.us' },
        rate_fixture:   { nom: 'Rates&Fixtures',    id: '243890177777-1574181414@g.us' }
    },
    heuresBrief: ['10:00', '12:00', '17:00']
};
