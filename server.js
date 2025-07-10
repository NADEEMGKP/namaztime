process.env.TZ = 'Asia/Kolkata'; // Set timezone to IST

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Firebase initialization
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
const tokensCollection = db.collection('tokens');
const hadithsCollection = db.collection('hadiths');

// Track processed hadiths to prevent duplicates
const processedHadiths = new Set();

/* -------------------- Helper Functions -------------------- */

async function removeInvalidToken(token) {
  try {
    await tokensCollection.doc(token).delete();
    console.log(`🗑️ Removed invalid token: ${token}`);
  } catch (err) {
    console.error('❌ Error removing invalid token:', err.message);
  }
}

/* -------------------- Namaz Notifications -------------------- */

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

/* -------------------- Hadith Notifications -------------------- */

async function sendHadithNotification(token, hadithData) {
  const notificationKey = `${token}-${hadithData.id}`;
  
  if (processedHadiths.has(notificationKey)) {
    console.log(`⏩ Skipping duplicate hadith notification for ${hadithData.id}`);
    return;
  }

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
    processedHadiths.add(notificationKey);
    console.log(`✅ Hadith notification sent to ${token}`);
  } catch (err) {
    console.error('❌ FCM error for hadith notification:', err.message);
    if (err.code === 'messaging/invalid-registration-token' || 
        err.code === 'messaging/registration-token-not-registered') {
      await removeInvalidToken(token);
    }
  }
}

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

function setupHadithNotifications() {
  const unsubscribe = hadithsCollection
    .orderBy('createdAt', 'desc')
    .limit(1)
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const newHadith = change.doc.data();
          console.log('🆕 New hadith added:', change.doc.id);
          sendHadithNotifications(change.doc.id, newHadith);
        }
      });
    });

  console.log('✅ Hadith notification listener active');
  return unsubscribe;
}

/* -------------------- API Endpoints -------------------- */

app.post('/save-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send('Token missing');

  try {
    const docRef = tokensCollection.doc(token);
    const doc = await docRef.get();

    if (!doc.exists) {
      await docRef.set({ enabled: true });
      console.log(`✅ Token saved: ${token}`);
    }
    res.send('Token processed');
  } catch (err) {
    console.error('❌ Firestore save error:', err.message);
    res.status(500).send('Error processing token');
  }
});

app.post('/toggle-notification', async (req, res) => {
  const { token, enabled } = req.body;
  if (typeof enabled !== 'boolean' || !token) {
    return res.status(400).send('Invalid data');
  }

  try {
    await tokensCollection.doc(token).update({ enabled });
    console.log(`🔄 Notification ${enabled ? 'enabled' : 'disabled'} for ${token}`);
    res.send('Notification preference updated');
  } catch (err) {
    console.error('❌ Firestore update error:', err.message);
    res.status(500).send('Error updating preference');
  }
});

app.get('/send-namaz', async (req, res) => {
  const namazName = req.query.type;
  const valid = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  if (!valid.includes(namazName)) {
    return res.status(400).send('Invalid namaz type');
  }

  await sendNamazNotifications(namazName);
  res.send(`Namaz notification sent for ${namazName}`);
});

app.post('/send-hadith-notification', async (req, res) => {
  const { hadithId } = req.body;
  if (!hadithId) return res.status(400).send('Hadith ID missing');

  try {
    const hadithDoc = await hadithsCollection.doc(hadithId).get();
    if (!hadithDoc.exists) return res.status(404).send('Hadith not found');

    await sendHadithNotifications(hadithId, hadithDoc.data());
    res.send(`Hadith notification sent for ${hadithId}`);
  } catch (err) {
    console.error('❌ Error sending hadith notification:', err.message);
    res.status(500).send('Error sending notification');
  }
});

app.get('/ping', (req, res) => {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`🔁 Ping received at ${now}`);
  res.send('Server is running');
});

/* -------------------- Server Startup -------------------- */

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Delay initialization to avoid cold start issues
  setTimeout(() => {
    console.log('⏳ Initializing services...');

    // Schedule Namaz Notifications (5 times daily)
    cron.schedule('0 4 * * *', () => sendNamazNotifications('Fajr'));     // 4:00 AM
    cron.schedule('25 12 * * *', () => sendNamazNotifications('Dhuhr'));  // 12:25 PM
    cron.schedule('50 15 * * *', () => sendNamazNotifications('Asr'));    // 3:50 PM
    cron.schedule('0 17 * * *', () => sendNamazNotifications('Maghrib')); // 5:00 PM
    cron.schedule('35 20 * * *', () => sendNamazNotifications('Isha'));   // 8:35 PM

    // Setup Hadith Notifications (triggered only on new posts)
    setupHadithNotifications();

    console.log('✅ All services initialized');
  }, 60000); // 60 second delay
});