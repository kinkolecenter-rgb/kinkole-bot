const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const Redis = require('ioredis');
const QRCode = require('qrcode');
const express = require('express');
const { Boom } = require('@hapi/boom');

const config = require('./config');
const redisAuth = require('./auth/redisAuth');
const traiterMessage = require('./services/reportService');

const app = express();
let currentQR = null;
let isConnected = false;

// Connexion native Upstash Redis (avec TLS requis)
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
    const { state, saveCreds } = await redisAuth(redis, 'kinkole-session');

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
            console.log('🔄 Nouveau QR Code généré');
            currentQR = await QRCode.toDataURL(qr);
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            console.log('❌ Connexion fermée. Code erreur:', lastDisconnect.error?.output?.statusCode);
            
            if (shouldReconnect) {
                console.log('🔄 Reconnexion dans 5s...');
                setTimeout(startBot, 5000);
            } else {
                console.log('⚠️ Déconnecté manuellement. Suppression de la session Redis...');
                const keys = await redis.keys('kinkole-session:*');
                if (keys.length > 0) await redis.del(keys);
                startBot();
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp connecté !');
            try {
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: '🤖 *Bot Kinkole 2.0 actif et connecté !*' });
            } catch (e) {}
        }
    });

sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            // On ignore les messages du bot lui-même ou des groupes
            if (msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) continue;
            
            // Extraction robuste du numéro (ignore les extensions d'appareils comme :1 ou :2)
            const expediteur = msg.key.remoteJid.split('@')[0].split(':')[0];
            
            // On affiche dans Railway qui essaie de parler au bot
            console.log(`\n📩 NOUVEAU MESSAGE DÉTECTÉ`);
            console.log(`👤 De : ${expediteur} | 🎯 Attendu : ${config.monNumero}`);
            
            // Vérification de sécurité
            if (expediteur !== String(config.monNumero)) {
                console.log(`🚫 Message ignoré (Numéro non autorisé)`);
                continue; 
            }
            
            // Extraction du texte
            const texte = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            console.log(`📝 Texte reçu : "${texte}"`);
            
            // Si le texte n'est pas vide, on l'envoie au service de rapport
            if (texte) {
                await traiterMessage(sock, msg.key.remoteJid, texte);
            } else {
                console.log(`⚠️ Le message ne contient pas de texte lisible.`);
            }
        }
    });
}

// Serveur Web pour afficher le QR sur Railway
app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1 style="color:green;text-align:center;font-family:sans-serif;margin-top:50px">✅ Le Bot Kinkole est connecté !</h1>');
    } else if (currentQR) {
        res.send(`
            <div style="text-align:center;font-family:sans-serif;margin-top:50px">
                <h2>📱 Scannez ce QR Code avec WhatsApp</h2>
                <img src="${currentQR}" alt="QR Code" style="width:300px;height:300px;"/>
                <p>La page se rafraîchit automatiquement toutes les 15 secondes.</p>
                <script>setTimeout(() => location.reload(), 15000)</script>
            </div>
        `);
    } else {
        res.send('<h1 style="text-align:center;font-family:sans-serif;margin-top:50px">⏳ Démarrage en cours... Veuillez rafraîchir dans 5 secondes.</h1>');
    }
});

app.listen(config.port, () => {
    console.log(`🌐 Serveur Web sur le port ${config.port}`);
    startBot();
});
