# Fallout Wiki API

A secure backend proxy for the Fallout Wiki AI chatbot. This Vercel serverless function safely holds your Gemini API key server-side and provides a secure endpoint for your Blogger frontend.

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

✅ API key is **never exposed** in public code  
✅ System prompt is **protected on the server**  
✅ CORS headers properly configured  
✅ Proper error handling with detailed error messages  
✅ Input validation  

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
