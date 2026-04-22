import express from 'express';
import { verifyWebhookSignature } from '@cepage/sdk/signature';

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const SECRET = process.env.CEPAGE_WEBHOOK_SECRET;

if (!SECRET) {
  console.error('CEPAGE_WEBHOOK_SECRET is required');
  process.exit(1);
}

// Use raw body so the bytes we hash match exactly what Cepage signed.
// JSON parsing happens after verification, if at all.
app.post(
  '/cepage-webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const header = req.header('cepage-signature');
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';

    const ok = await verifyWebhookSignature({
      secret: SECRET,
      body: rawBody,
      header,
    });
    if (!ok) {
      console.warn('rejected delivery (bad signature)');
      return res.status(401).send('bad signature');
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.warn('rejected delivery (invalid json)');
      return res.status(400).send('invalid json');
    }

    console.log('webhook delivered:', {
      event: payload.event,
      id: payload.id,
      data: payload.data,
    });
    res.status(200).send('ok');
  },
);

app.listen(PORT, () => {
  console.log(`cepage webhook receiver listening on http://localhost:${PORT}`);
});
