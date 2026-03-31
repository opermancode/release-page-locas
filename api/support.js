// Disable Vercel's automatic body parsing to allow large images/files
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL;

  // 1. Check if the Secret is actually there
  if (!DISCORD_URL) {
    console.error("CRITICAL: DISCORD_WEBHOOK_URL is not defined in Vercel secrets.");
    return res.status(500).json({ error: "Server configuration error (Secret missing)." });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 2. Forward the request to Discord
    // We use 'req' directly as the body. 
    // In Vercel, 'req' is a readable stream.
    const response = await fetch(DISCORD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'], // This passes the 'boundary' for the image
      },
      body: req,
      // Duplex is required when body is a stream in Node.js fetch
      duplex: 'half', 
    });

    if (response.ok) {
      return res.status(200).json({ success: true });
    } else {
      const errorData = await response.text();
      console.error("Discord rejected the request:", errorData);
      return res.status(response.status).json({ error: "Discord rejected the message." });
    }
  } catch (error) {
    console.error("API Error:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
