export default async function handler(req, res) {
  // This value is pulled from your Provider's Dashboard (Vercel/Netlify Secrets)
  // It NEVER reaches the user's browser.
  const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Forward the request to Discord
    const response = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      body: req.body, // Pass the FormData directly through
    });

    return res.status(response.status).json({ success: response.ok });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to proxy request' });
  }
}
