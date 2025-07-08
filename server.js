process.env.TZ = 'Asia/Kolkata'; // ✅ IST timezone

require('dotenv').config(); // Load .env

const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000; // ✅ Always use Render provided PORT

app.use(bodyParser.json());

// ✅ Initialize Firebase only if not already initialized
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: process.env.FIREBASE_AUTH_URI,
        token_uri: process.env.FIREBASE_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
      }),
    });
    console.log('✅ Firebase initialized');
  } catch (err) {
    console.error('❌ Firebase initialization failed:', err.message);
  }
}

const db = admin.firestore();
const tokensCollection = db.collection('tokens'); // 🔥 Firestore collection

/**
 * ✅ Save FCM Token
 */
app.post('/save-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('Token missing');

  try {
    const docRef = tokensCollection.doc(token);
    const doc = await docRef.get();

    if (!doc.exists) {
      await docRef.set({ enabled: true });
      console.log(`✅ Token saved: ${token}`);
    } else {
      console.log(`⚠️ Token already exists`);
    }

    res.send('Token saved');
  } catch (err) {
    console.error('❌ Firestore save error:', err.message);
    res.status(500).send('Error saving token');
  }
});

/**
 * ✅ Toggle Notification
 */
app.post('/toggle-notification', async (req, res) => {
  const { token, enabled } = req.body;
  if (typeof enabled !== 'boolean' || !token) return res.status(400).send('Invalid data');

  try {
    const docRef = tokensCollection.doc(token);
    const doc = await docRef.get();

    if (!doc.exists) return res.status(404).send('Token not found');

    await docRef.update({ enabled });
    console.log(`🔄 Token updated: ${token} → ${enabled}`);
    res.send('Updated');
  } catch (err) {
    console.error('❌ Firestore update error:', err.message);
    res.status(500).send('Error updating token');
  }
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
    console.log(`✅ Notification sent to ${token}`);
  } catch (err) {
    console.error('❌ FCM error:', err.message);
  }
}

/**
 * ✅ Send Notification to All Enabled Users
 */
async function sendNamazNotifications(namazName) {
  try {
    const snapshot = await tokensCollection.where('enabled', '==', true).get();

    if (snapshot.empty) {
      console.log('⚠️ No enabled users');
      return;
    }

    snapshot.forEach(doc => {
      const token = doc.id;
      sendNotification(token, namazName);
    });
  } catch (err) {
    console.error('❌ Firestore fetch error:', err.message);
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

  await sendNamazNotifications(namazName);
  res.send(`✅ Notification sent for ${namazName}`);
});

/**
 * ✅ Ping Route for Render Keep-Alive
 */
app.get('/ping', (req, res) => {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`🔁 Ping route hit at ${now}`);
  res.send('✅ Ping success');
});

/**
 * ✅ Wake-Up Route for External Cron Job
 */
app.get('/wake-up', (req, res) => {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`🔔 Server woke up via external cron job at ${now}`);
  res.send('✅ Server is awake');
});

/**
 * ✅ Start Server
 */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  // ✅ Delay starting cron jobs by 60 seconds (cold start safe)
  setTimeout(() => {
    console.log('⏳ Initializing cron jobs after delay...');

    /**
     * 🔥 Schedule Namaz Times (Matches your external cron)
     */
    cron.schedule('0 4 * * *', () => sendNamazNotifications('Fajr'));     // 4:00 AM
    cron.schedule('25 12 * * *', () => sendNamazNotifications('Dhuhr'));  // 12:25 PM
    cron.schedule('50 15 * * *', () => sendNamazNotifications('Asr'));    // 3:50 PM
    cron.schedule('0 17 * * *', () => sendNamazNotifications('Maghrib')); // 5:00 PM
    cron.schedule('35 20 * * *', () => sendNamazNotifications('Isha'));   // 8:35 PM

    console.log('✅ Cron jobs scheduled');
  }, 60000); // 60 sec delay
});
