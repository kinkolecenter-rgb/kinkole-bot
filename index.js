const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const Redis = require('ioredis');
const QRCode = require('qrcode');
const express = require('express');

const config = require('./config');
const redisStore = require('./auth/redisStore');
const traiterMessage = require('./services/reportService');
const creerMemoire = require('./services/memoire');
const creerAssistant = require('./services/assistant');
const { genererBrief } = require('./services/groq');

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

// Noms des groupes surveillés
const NOMS_GROUPES = {
    '120363021280044937@g.us': 'Synchro Kinkole',
    '120363023010071105@g.us': 'Synchro Kinkole pos',
    '120363025487823123@g.us': 'Winner Shop kinkole',
    '120363040045715280@g.us': 'Rapport PR terrain kinko',
    '243907634105-1540987363@g.us': 'PENALITy QS all shop',
    '243900435187-1521782366@g.us': 'General Management',
    '243900435187-1564931206@g.us': 'Évacuation Matériels shop',
    '243890011696-1509543437@g.us': 'Winner printing group',
    '120363039964661142@g.us': 'Printing Winner& Buco RDC',
    '243900435187-1560664753@g.us': 'Team Composition Shop',
    '243900435187-1543596785@g.us': 'MUKUMBUSU WINNER',
    '120363024619387743@g.us': 'Suivi Carburant Kinkole',
    '243900435187-1564716535@g.us': 'disparu,viré & no cloturé',
    '120363049897392666@g.us': 'Entre nous'
};

function planifierBriefs(assistant) {
    const verifierHeure = () => {
        const now = new Date();
        const heure = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        if (config.heuresBrief.includes(heure)) {
            assistant.briefAutomatique();
        }
    };
    setInterval(verifierHeure, 60000); // vérifie chaque minute
}

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await redisStore(redis, 'kinkole-session-v6');
    const memoire = creerMemoire(redis);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Kinkole Bot', 'Chrome', '2.0.0']
    });

    const assistant = creerAssistant(sock, memoire);

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
                const keys = await redis.keys('kinkole-session-v6:*');
                if (keys.length > 0) await redis.del(keys);
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

            // Pré-charger groupes destination
            setTimeout(async () => {
                const cibles = Object.values(config.groupesDestination).map(g => g.id);
                for (const jid of cibles) {
                    try {
                        await sock.groupMetadata(jid);
                        console.log(`✅ Groupe chargé: ${jid}`);
                    } catch(e) {
                        console.error(`❌ Groupe non accessible: ${jid}`);
                    }
                }
            }, 5000);

            // Planifier briefs automatiques
            planifierBriefs(assistant);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const texte = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (!texte) continue;

            // Messages des groupes surveillés → stocker en mémoire
            if (jid.includes('@g.us') && config.groupesSurveilles.includes(jid)) {
                const expediteur = msg.pushName || msg.key.participant?.split('@')[0] || 'Inconnu';
                await memoire.sauvegarderMessage(jid, {
                    groupeJid: jid,
                    groupeNom: NOMS_GROUPES[jid] || jid,
                    expediteur,
                    texte,
                    timestamp: Date.now()
                });
                console.log(`💾 Sauvegardé [${NOMS_GROUPES[jid]}] ${expediteur}: ${texte.substring(0, 50)}`);
                continue;
            }

            if (jid.includes('@g.us')) continue;

            // Messages privés — vérifier autorisation
            const expediteur = jid.split('@')[0].split(':')[0];
            const autorise = [
                String(config.monNumero),
                String(config.monLid),
                String(config.secondaireLid)
            ].filter(Boolean);

            if (!autorise.includes(expediteur)) continue;

            console.log(`📝 "${texte}" | JID: ${jid}`);

            // PING
            if (texte.trim().toUpperCase() === 'PING') {
                await sock.sendMessage(`${config.monNumero}@s.whatsapp.net`, { text: 'PONG ✅' });
                continue;
            }

            await sock.readMessages([msg.key]);
            await sock.sendPresenceUpdate('composing', jid);

            // Essayer commande assistant d'abord
            const traitePar = await assistant.traiterCommande(texte, jid);
            if (!traitePar) {
                // Sinon bot rapports classique
                await traiterMessage(sock, jid, texte);
            }
        }
    });
}

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
