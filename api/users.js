const admin = require('firebase-admin');

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  return admin.initializeApp({ credential: admin.credential.cert(sa) });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify admin token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    getApp();
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.email !== 'omkarjagtap@gmail.com') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await admin.auth().listUsers(1000);
    const db = admin.firestore();

    const users = await Promise.all(result.users.map(async (u) => {
      const c = u.customClaims || {};
      let deviceCount = 0;
      let devices = [];
      try {
        const snap = await db.collection('users').doc(u.uid).collection('devices').get();
        deviceCount = snap.size;
        devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (_) {}

      const daysLeft = c.licenseExpiry
        ? Math.ceil((new Date(c.licenseExpiry) - new Date()) / 86400000)
        : null;

      return {
        uid: u.uid,
        email: u.email,
        disabled: u.disabled,
        createdAt: u.metadata.creationTime,
        lastLogin: u.metadata.lastSignInTime,
        plan: c.plan || 'trial',
        licenseExpiry: c.licenseExpiry || null,
        blocked: c.blocked || false,
        maxDevices: c.maxDevices || 2,
        cloudSync: c.cloudSync || false,
        daysLeft,
        deviceCount,
        devices,
      };
    }));

    return res.status(200).json({ users });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};