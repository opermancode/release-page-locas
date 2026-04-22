const admin = require('firebase-admin');

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  return admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const PLANS = {
  trial:    { maxDevices: 2, cloudSync: false },
  yearly:   { maxDevices: 5, cloudSync: true  },
  lifetime: { maxDevices: 5, cloudSync: true  },
};

const addDays = (base, days) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

async function sendPush(db, email, data) {
  try {
    const doc = await db.collection('fcm_tokens').doc(email.replace(/[.@]/g, '_')).get();
    if (!doc.exists || !doc.data().token) return;
    await admin.messaging().send({
      token: doc.data().token,
      data: { type: 'license_update', ...data },
      android: { priority: 'high' },
      apns: { payload: { aps: { contentAvailable: true } } },
    });
  } catch (_) {}
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    getApp();
    const db = admin.firestore();

    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.email !== 'omkarjagtap@gmail.com') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { action, email, password, days, deviceId } = req.body;

    switch (action) {

      case 'create': {
        const user = await admin.auth().createUser({ email, password, emailVerified: true });
        const exp = addDays(new Date(), 30);
        const plan = PLANS.trial;
        await admin.auth().setCustomUserClaims(user.uid, {
          licenseExpiry: exp, plan: 'trial', blocked: false,
          maxDevices: plan.maxDevices, cloudSync: plan.cloudSync,
        });
        return res.json({ ok: true, uid: user.uid, licenseExpiry: exp });
      }

      case 'extend': {
        const user = await admin.auth().getUserByEmail(email);
        const claims = user.customClaims || {};
        let base = new Date();
        if (claims.licenseExpiry && new Date(claims.licenseExpiry) > base) base = new Date(claims.licenseExpiry);
        const exp = addDays(base, days || 365);
        const plan = PLANS.yearly;
        await admin.auth().setCustomUserClaims(user.uid, {
          ...claims, licenseExpiry: exp, plan: 'yearly', blocked: false,
          maxDevices: plan.maxDevices, cloudSync: plan.cloudSync,
        });
        await sendPush(db, email, { action: 'extend', expiryDate: exp, plan: 'yearly', maxDevices: '5', cloudSync: 'true' });
        return res.json({ ok: true, licenseExpiry: exp });
      }

      case 'lifetime': {
        const user = await admin.auth().getUserByEmail(email);
        const plan = PLANS.lifetime;
        await admin.auth().setCustomUserClaims(user.uid, {
          licenseExpiry: null, plan: 'lifetime', blocked: false,
          maxDevices: plan.maxDevices, cloudSync: plan.cloudSync,
        });
        await sendPush(db, email, { action: 'extend', expiryDate: '', plan: 'lifetime', maxDevices: '5', cloudSync: 'true' });
        return res.json({ ok: true });
      }

      case 'block': {
        const user = await admin.auth().getUserByEmail(email);
        const claims = user.customClaims || {};
        await admin.auth().setCustomUserClaims(user.uid, { ...claims, blocked: true });
        await admin.auth().updateUser(user.uid, { disabled: true });
        await sendPush(db, email, { action: 'block' });
        return res.json({ ok: true });
      }

      case 'unblock': {
        const user = await admin.auth().getUserByEmail(email);
        const claims = user.customClaims || {};
        await admin.auth().setCustomUserClaims(user.uid, { ...claims, blocked: false });
        await admin.auth().updateUser(user.uid, { disabled: false });
        await sendPush(db, email, { action: 'unblock' });
        return res.json({ ok: true });
      }

      case 'relogin': {
        const user = await admin.auth().getUserByEmail(email);
        await sendPush(db, email, { action: 'relogin' });
        return res.json({ ok: true });
      }

      case 'delete': {
        const user = await admin.auth().getUserByEmail(email);
        try { await db.collection('fcm_tokens').doc(email.replace(/[.@]/g, '_')).delete(); } catch (_) {}
        try {
          const devRef = db.collection('users').doc(user.uid).collection('devices');
          const devs = await devRef.get();
          const batch = db.batch();
          devs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        } catch (_) {}
        try { await db.collection('users').doc(user.uid).delete(); } catch (_) {}
        await admin.auth().deleteUser(user.uid);
        return res.json({ ok: true });
      }

      case 'removedevice': {
        const user = await admin.auth().getUserByEmail(email);
        await db.collection('users').doc(user.uid).collection('devices').doc(deviceId).delete();
        await sendPush(db, email, { action: 'device_removed', deviceId });
        return res.json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};