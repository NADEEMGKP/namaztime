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

/* -------------------- Common Notification Functions -------------------- */

/**
 * ✅ Remove invalid FCM token
 */
async function removeInvalidToken(token) {
  try {
    await tokensCollection.doc(token).delete();
    console.log(`🗑️ Removed invalid token: ${token}`);
  } catch (err) {
    console.error('❌ Error removing invalid token:', err.message);
  }
}

/* -------------------- Namaz Notification Functions -------------------- */

/**
 * ✅ Send Namaz Notification
 */
async function sendNamazNotification(token, namazName) {
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
    console.log(`✅ Namaz notification sent to ${token}`);
  } catch (err) {
    console.error('❌ FCM error:', err.message);
    if (err.code === 'messaging/invalid-registration-token' || 
        err.code === 'messaging/registration-token-not-registered') {
      await removeInvalidToken(token);
    }
  }
}

/**
 * ✅ Send Namaz Notifications to All Enabled Users
 */
async function sendNamazNotifications(namazName) {
  try {
    const snapshot = await tokensCollection.where('enabled', '==', true).get();

    if (snapshot.empty) {
      console.log('⚠️ No enabled users for namaz notifications');
      return;
    }

    const promises = snapshot.docs.map(doc => 
      sendNamazNotification(doc.id, namazName)
    );

    await Promise.all(promises);
    console.log(`✅ All namaz notifications sent for ${namazName}`);
  } catch (err) {
    console.error('❌ Firestore fetch error:', err.message);
  }
}

/* -------------------- Hadith Notification Functions -------------------- */

/**
 * ✅ Send Hadith Notification
 */
async function sendHadithNotification(token, hadithData) {
  try {
    const notification = {
      token,
      notification: {
        title: `नया हदीस: ${hadithData.category || 'Islamic Hadith'}`,
        body: hadithData.text.length > 50 
          ? `${hadithData.text.substring(0, 50)}...` 
          : hadithData.text,
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'hadith_channel',
        },
      },
      data: {
        type: 'hadith',
        hadithId: hadithData.id,
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      }
    };

    await admin.messaging().send(notification);
    console.log(`✅ Hadith notification sent to ${token}`);
  } catch (err) {
    console.error('❌ FCM error for hadith notification:', err.message);
    if (err.code === 'messaging/invalid-registration-token' || 
        err.code === 'messaging/registration-token-not-registered') {
      await removeInvalidToken(token);
    }
  }
}

/**
 * ✅ Send Hadith Notifications to All Enabled Users
 */
async function sendHadithNotifications(hadithId, hadithData) {
  try {
    const snapshot = await tokensCollection.where('enabled', '==', true).get();

    if (snapshot.empty) {
      console.log('⚠️ No enabled users for hadith notifications');
      return;
    }

    const fullHadithData = { ...hadithData, id: hadithId };
    const promises = snapshot.docs.map(doc => 
      sendHadithNotification(doc.id, fullHadithData)
    );

    await Promise.all(promises);
    console.log(`✅ All hadith notifications sent for ${hadithId}`);
  } catch (err) {
    console.error('❌ Error sending hadith notifications:', err.message);
  }
}

/**
 * ✅ Setup Firestore Trigger for New Hadiths
 */
function setupHadithNotifications() {
  const hadithsRef = db.collection('hadiths');
  
  hadithsRef.orderBy('createdAt', 'desc').limit(1)
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const newHadith = change.doc.data();
          console.log('🆕 New hadith added:', change.doc.id);
          sendHadithNotifications(change.doc.id, newHadith);
        }
      });
    });
  
  console.log('✅ Hadith notification listener active');
}

/* -------------------- API Endpoints -------------------- */

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
 * ✅ API: Manually Trigger Hadith Notification
 */
app.post('/send-hadith-notification', async (req, res) => {
  const { hadithId } = req.body;
  
  if (!hadithId) {
    return res.status(400).send('Hadith ID missing');
  }

  try {
    const hadithDoc = await db.collection('hadiths').doc(hadithId).get();
    
    if (!hadithDoc.exists) {
      return res.status(404).send('Hadith not found');
    }

    await sendHadithNotifications(hadithId, hadithDoc.data());
    res.send(`✅ Hadith notification sent for ${hadithId}`);
  } catch (err) {
    console.error('❌ Error sending hadith notification:', err.message);
    res.status(500).send('Error sending hadith notification');
  }
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

  // ✅ Delay starting services by 60 seconds (cold start safe)
  setTimeout(() => {
    console.log('⏳ Initializing services after delay...');

    // Schedule Namaz Times
    cron.schedule('0 4 * * *', () => sendNamazNotifications('Fajr'));     // 4:00 AM
    cron.schedule('25 12 * * *', () => sendNamazNotifications('Dhuhr'));  // 12:25 PM
    cron.schedule('50 15 * * *', () => sendNamazNotifications('Asr'));    // 3:50 PM
    cron.schedule('0 17 * * *', () => sendNamazNotifications('Maghrib')); // 5:00 PM
    cron.schedule('35 20 * * *', () => sendNamazNotifications('Isha'));   // 8:35 PM

    // Setup hadith notifications listener
    setupHadithNotifications();

    console.log('✅ All services initialized');
  }, 60000); // 60 sec delay
});