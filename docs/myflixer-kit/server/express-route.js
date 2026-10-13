app.get('/api/stream/:id?', async (req, res) => {
  const host = req.headers?.host || `localhost:${PORT}`;
  const proto = req.protocol || 'http';
  const baseOrigin = `${proto}://${host}`;
  const streamPrefix = `${baseOrigin}/api/stream`;

  if (req.query?.proxy === '1') {
    const targetUrl = req.query?.url ? decodeURIComponent(req.query.url) : '';
    return handleStreamProxy(targetUrl, req, res, streamPrefix);
  }

  if (req.query?.embed === '1') {
    const embedId = decodeURIComponent(req.query?.id || req.params?.id || '');
    if (!embedId || !embedId.startsWith('mf:')) {
      return res.status(400).send('Invalid or missing stream ID');
    }
    return handleEmbedPlayer(embedId, req, res, streamPrefix);
  }

  const id = req.query.id || req.params.id;
  if (id && id.startsWith('mf:')) {
    try {
      const data = await resolveMyflixerStream(id, streamPrefix);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.status(404).json({ error: 'not supported' });
