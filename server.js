process.env.TZ = 'Asia/Kolkata'; // ✅ IST timezone

require('dotenv').config(); // Load .env

const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const fs = require('fs');

// 🔐 Firebase service account from ENV
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
  }),
});

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN_PATH = 'tokens.json';

app.use(bodyParser.json());

/**
 * ✅ Save FCM Token
 */
app.post('/save-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('Token missing');

  let tokens = fs.existsSync(TOKEN_PATH)
    ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'))
    : [];

  const exists = tokens.find(t => t.token === token);

  if (!exists) {
    tokens.push({ token, enabled: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    // console.log(`✅ Token saved: ${token}`);
  } else {
    // 🔇 Commented out to avoid spammy logs
    // console.log(`⚠️ Token already exists`);
  }

  res.send('Token saved');
});

/**
 * ✅ Toggle Notification
 */
app.post('/toggle-notification', (req, res) => {
  const { token, enabled } = req.body;
  if (typeof enabled !== 'boolean' || !token) return res.status(400).send('Invalid data');

  if (!fs.existsSync(TOKEN_PATH)) return res.status(404).send('Token file missing');

  let tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  const index = tokens.findIndex(t => t.token === token);
  if (index === -1) return res.status(404).send('Token not found');

  tokens[index].enabled = enabled;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  // console.log(`🔄 Token updated to: ${enabled}`);
  res.send('Updated');
});

/**
 * ✅ Send Notification
 */
async function sendNotification(token, namazName) {
  try {
    await admin.messaging().send({
      token,
      android: {
        priority: 'high',
        notification: {
          title: 'Namaz Reminder',
          body: `${namazName} का समय हो गया है`,
          sound: 'azan',
          channelId: 'namaz_channel',
        },
      },
    });
    // console.log(`✅ Notification sent to ${token}`);
  } catch (err) {
    console.error('❌ FCM error:', err.message);
  }
}

/**
 * ✅ API: /send-namaz?type=fajr
 */
app.get('/send-namaz', async (req, res) => {
  const namazName = req.query.type;
  const valid = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  if (!namazName || !valid.includes(namazName)) {
    return res.status(400).send('Invalid namaz type');
  }

  if (!fs.existsSync(TOKEN_PATH)) return res.status(404).send('Token file not found');

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  const enabledTokens = tokens.filter(t => t.enabled).map(t => t.token);

  if (enabledTokens.length === 0) return res.send('No enabled users');

  enabledTokens.forEach(token => sendNotification(token, namazName));
  res.send(`✅ Notification sent for ${namazName}`);
});

/**
 * ✅ Ping Route for Render Keep-Alive
 */
app.get('/ping', (req, res) => {
  // 🔇 Removed console.log to avoid "output too large" warning
  res.send('✅ Ping success');
});

/**
 * ✅ Start Server
 */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
