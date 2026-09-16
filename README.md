# Fallout Wiki API

A backend proxy for the Fallout Wiki AI chatbot. This Vercel serverless function holds your Gemini API key server-side and provides an endpoint for your Blogger frontend. The endpoint is public; authentication and rate limiting are not implemented.

## Connecting the existing Fallout Hub chats

1. Revoke any API keys included in the public Blogger page/widget scripts. If Vercel uses one of those keys, replace `GEMINI_API_KEY` with a new key in its Production environment.
2. Push these changes to the repository connected to Vercel and deploy to Production.
3. Copy the project's stable **production domain** from Vercel, then append `/api/chat`. The supplied deployment-specific URL redirected to Vercel login during inspection. Use a public production domain; Vercel's Standard Protection can keep preview/deployment URLs protected while allowing production visitors. See [Deployment Protection](https://vercel.com/docs/deployment-protection).
4. Put that public endpoint in `PROXY_URL` in `BLOGGER_FRONTEND.html`.
5. Replace the old AI chat `<script>` in **both** the wiki page and the floating Blogger widget with this script. Keep their existing HTML/CSS. Remove both original scripts and their embedded keys; leaving either in place causes conflicts. Use the same endpoint in both copies.
6. Open the wiki page signed out, test the embedded chat and floating widget separately, then test the widget on the home page. Successful requests should go to your Vercel `/api/chat` endpoint and return `{ "reply": "..." }`.

The replacement script scopes input, loading state, and messages to each chat container, so the existing duplicate element IDs do not mix conversations. It preserves widget open/close behavior, prevents duplicate sends while waiting, renders user input as text, and escapes AI/error text before adding basic formatting. Browser layout still needs checking after pasting into Blogger.

## Model fallback

Each message tries these models in order, stopping at the first answer:

1. `gemini-flash-latest`
2. `gemini-3.1-flash-lite`
3. `gemini-2.5-flash-lite`

The Flash-Lite choices have lower published text-token prices than current Flash models. Model availability, prices, and quotas can change: see Google's [models](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing), and [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits). The `latest` alias can change its underlying model. Quotas are per project, vary by model, and are not reset by fallback. On a paid project, successful fallback requests are billed normally.

Fallback happens on HTTP 429 (quota), 404 (unavailable model), 408, 500, 502, 503, 504, network failures, and timeouts. Invalid requests/credentials and safety blocks stop immediately. Each model gets one attempt with a 15-second timeout; Vercel's function duration is set to 60 seconds. Every new message starts at the first model; there is no persistent quota cooldown or shared cache. Exhausted quotas return 429; mixed availability failures return 503.

Optionally set `GEMINI_MODELS` in Vercel to a comma-separated ordered list of one to three model IDs, then redeploy. The default requires only `GEMINI_API_KEY`. Model selection cannot be overridden by the browser. Vercel logs include attempted model names/statuses and the successful model, but not messages or keys.

Messages are limited to 6,000 characters and generations to 2,048 output tokens (including any model thinking), so long answers may be cut short. The request uses Gemini's `systemInstruction` field for the Fallout persona. This guides behavior; it is not a guarantee against prompt injection. There is no conversation history.

## Local checks

Use Node.js 22 or newer and run `npm test`. Tests mock Gemini, so they need no API key and consume no quota. In restricted environments that cannot spawn test workers, run `node --test --test-isolation=none` on Node.js 24. Live model access must still be checked after deployment.

## Project Structure

```
fallout-wiki-api/
├── api/
│   └── chat.js          # Main API endpoint (serverless function)
├── package.json         # Project metadata
├── vercel.json          # Vercel configuration with CORS headers
└── README.md           # This file
```

## Setup Instructions

### 1. Create a New Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click **Create API Key**
3. Copy your new key (you'll need this in step 4)
4. **Important:** Delete or disable your old key from the Blogger page (it's compromised)

### 2. Push to GitHub

1. Create a new public repository at [GitHub](https://github.com/new) (name: `fallout-wiki-api`)
2. Push these files to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Fallout Wiki API backend"
   git remote add origin https://github.com/YOUR-USERNAME/fallout-wiki-api.git
   git branch -M main
   git push -u origin main
   ```

### 3. Deploy to Vercel

1. Go to [Vercel](https://vercel.com)
2. Click **Add New Project**
3. Import your GitHub repository (`fallout-wiki-api`)
4. In **Environment Variables** section, add:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** Your new Gemini API key (from step 1)
   - **Environments:** Check Production, Preview, and Development
5. Click **Deploy**

After deployment, you'll get a URL like: `https://fallout-wiki-api.vercel.app`

Your API endpoint will be: `https://fallout-wiki-api.vercel.app/api/chat`

### 4. Update Your Blogger Frontend

Replace the `PROXY_URL` in your Blogger script with:

```javascript
const PROXY_URL = 'https://YOUR-PROJECT-NAME.vercel.app/api/chat';
```

See `BLOGGER_FRONTEND.html` for the complete updated code.

## How It Works

1. **Blogger Frontend** sends user messages to your Vercel endpoint
2. **Vercel Backend** receives the message and safely calls Google's Gemini API with:
   - Your API key (stored securely in Vercel environment variables)
   - The system prompt (fixed on server-side)
   - The user's message
3. **Gemini API** generates a Fallout-themed response
4. **Response** is sent back to the frontend and displayed in the chat

## Security Features

- API key is stored on the server, not included in the replacement frontend.
- System instructions are configured on the server.
- CORS allows the Blogger frontend to call the endpoint.
- Model fallback and user-facing errors avoid exposing upstream diagnostics.
- Input validation limits the size and type of messages.

## API Endpoint

**POST** `/api/chat`

### Request Body
```json
{
  "message": "What is the Brotherhood of Steel?"
}
```

### Success Response (200)
```json
{
  "reply": "The Brotherhood of Steel is..."
}
```

### Error Response (400-500)
```json
{
  "error": "Error message describing what went wrong"
}
```

## Optional Improvements (Future)

- Add conversation history (send previous messages for context)
- Implement rate limiting
- Restrict CORS to only your Blogger domain
- Add response streaming
- Cache frequently asked questions

## Troubleshooting

**"Server misconfigured"** → Environment variable `GEMINI_API_KEY` not set in Vercel

**"API Error"** → Check that your Gemini API key is valid and hasn't been disabled

**CORS errors** → Make sure `vercel.json` has the correct CORS headers

## License

This project is for personal use.
