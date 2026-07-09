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
    const { state, saveCreds } = await redisAuth(redis, 'kinkole-session-v3');
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'info' }),
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
            
            // On extrait le code d'erreur proprement
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('❌ Connexion fermée. Code erreur:', statusCode);
            
            // Si l'erreur est 401 (Logged Out), on vide la base de données
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('🔴 Session expirée ou révoquée (401). Nettoyage de Redis...');
                
                // On efface les anciennes clés corrompues
                const keys = await redis.keys('kinkole-session:*');
                if (keys.length > 0) {
                    await redis.del(keys);
                }
                
                console.log('🔄 Relance immédiate pour générer un nouveau QR Code...');
                startBot();
            } else {
                // Pour toute autre erreur de réseau (ex: 515), on tente une reconnexion
                console.log('🔄 Reconnexion dans 5s...');
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('✅ WhatsApp connecté !');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) continue;
            
            const expediteur = msg.key.remoteJid.split('@')[0].split(':')[0];
            
            if (expediteur !== String(config.monNumero) && expediteur !== String(config.monLid)) {
                continue; 
            }
            
            const texte = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            console.log(`📝 Texte reçu : "${texte}" | Depuis JID : ${msg.key.remoteJid}`);
            
            if (texte === "PING") {
                console.log("🛠️ TEST DIRECT");
            
                console.log("RemoteJid :", msg.key.remoteJid);
                console.log("Message key :", JSON.stringify(msg.key, null, 2));
                console.log("PushName :", msg.pushName);
            
                const contact = await sock.onWhatsApp(config.monNumero);
                console.log("onWhatsApp :", JSON.stringify(contact, null, 2));
            
                await sock.sendMessage(msg.key.remoteJid, {
                    text: "PONG"
                });
            
                continue;
            }
            
            if (texte) {
                await sock.readMessages([msg.key]);
                await sock.sendPresenceUpdate('composing', msg.key.remoteJid);
                
                // On passe le remoteJid intact (le LID) et le message entier (msg)
                await traiterMessage(sock, msg.key.remoteJid, texte, msg);
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
