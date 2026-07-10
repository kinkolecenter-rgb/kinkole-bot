const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const Redis = require('ioredis');
const QRCode = require('qrcode');
const express = require('express');

const config = require('./config');
const redisStore = require('./auth/redisStore');
const traiterMessage = require('./services/reportService');

const app = express();
let currentQR = null;
let isConnected = false;

const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.username,
    password: config.redis.password,
    tls: {}
});

redis.on('connect', () => console.log('✅ Connecté à Upstash Redis'));
redis.on('error', (err) => console.error('❌ Erreur Redis:', err));

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await redisStore(redis, 'kinkole-session-v4');

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Kinkole Bot', 'Chrome', '2.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('🔄 QR Code généré');
            currentQR = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('❌ Connexion fermée. Code:', statusCode);

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('🔴 Session expirée. Nettoyage Redis...');
                const keys = await redis.keys('kinkole-session-v4:*');
                if (keys.length > 0) await redis.del(keys);
                console.log('🔄 Relance pour nouveau QR...');
                startBot();
            } else {
                console.log('🔄 Reconnexion dans 5s...');
                setTimeout(startBot, 5000);
            }
        }

        if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp connecté !');
            
            setTimeout(async () => {
                try {
                    const groupes = await sock.groupFetchAllParticipating();
                    const liste = Object.values(groupes);
                    console.log(`📊 Nombre de groupes : ${liste.length}`);
                    liste.forEach(g => console.log(`📌 ${g.subject} → ${g.id}`));
                } catch(e) {
                    console.error('❌ Erreur groupes:', e.message);
                }
            }, 5000); // attend 5s après connexion
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) continue;

            const expediteur = msg.key.remoteJid.split('@')[0].split(':')[0];
            const autorise = [String(config.monNumero), String(config.monLid)];
            if (!autorise.includes(expediteur)) continue;

            const texte = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (!texte) continue;

            console.log(`📝 "${texte}" | JID: ${msg.key.remoteJid}`);

            // Commande de test
            if (texte.trim().toUpperCase() === 'PING') {
                const contact = await sock.onWhatsApp(config.monNumero);
                if (contact?.length > 0) {
                    await sock.sendMessage(contact[0].jid, { text: 'PONG ✅' });
                }
                continue;
            }

            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
            await traiterMessage(sock, msg.key.remoteJid, texte);
        }
    });
}

// Interface Web QR
app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1 style="color:green;text-align:center;font-family:sans-serif;margin-top:50px">✅ Bot Kinkole connecté !</h1>');
    } else if (currentQR) {
        res.send(`
            <div style="text-align:center;font-family:sans-serif;margin-top:50px">
                <h2>📱 Scannez ce QR Code avec WhatsApp</h2>
                <img src="${currentQR}" style="width:300px;height:300px"/>
                <p>Rafraîchissement automatique toutes les 15 secondes.</p>
                <script>setTimeout(() => location.reload(), 15000)</script>
            </div>
        `);
    } else {
        res.send('<h1 style="text-align:center;font-family:sans-serif;margin-top:50px">⏳ Démarrage en cours... Rafraîchissez dans 5s.</h1>');
    }
});

app.listen(config.port, () => {
    console.log(`🌐 Serveur sur port ${config.port}`);
    startBot();
});
