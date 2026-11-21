# WatchBeam 🎬

A personal watch party app powered by [HyperBeam](https://hyperbeam.com). Watch anything together in a synchronized virtual browser with live text chat.

> **Portfolio / Showcase project** — built for personal use with the HyperBeam free tier (max 2 rooms).

---

## Features

- 🌐 **Shared virtual browser** via HyperBeam — watch YouTube, Netflix, anime, anything
- 💬 **Real-time text chat** via WebSocket
- 🔗 **Shareable room links** — just paste the URL to invite friends
- 👤 **Local username** — no sign-up, stored in your browser
- 📱 **Fully responsive** — works on mobile and desktop
- 🎨 **Dark glassmorphism UI** with gradient accents

## Setup

### 1. Clone & install

```bash
# Install dependencies for both server and client
cd watchHyperBeam
npm run install:all
```

### 2. Configure HyperBeam API key

```bash
# In the server directory, copy the example env file
cp server/.env.example server/.env
```

Edit `server/.env` and add your HyperBeam API key:
```
HYPERBEAM_API_KEY=your_key_from_hyperbeam_dashboard
```

> Get your free API key at [hyperbeam.com](https://hyperbeam.com) → Dashboard

### 3. Run (development)

Open **two terminals**:

```bash
# Terminal 1 — Backend (port 3000)
npm run dev:server

# Terminal 2 — Frontend (port 5173)
npm run dev:client
```

Then open **http://localhost:5173**

### 4. Deploy for Free (1-Click Style)

Because this app uses persistent WebSockets for live chat, deploy the backend to a platform that supports WebSockets. The Express server is already configured to automatically serve the Vite frontend from the same domain in production:

#### Recommended: **Render.com** (Free Web Service)
1. Push your repository to **GitHub**.
2. Go to [render.com](https://render.com) and create a **New Web Service**.
3. Connect your GitHub repo.
4. Set:
   - **Environment:** `Node`
   - **Build Command:** `npm run install:all && npm run build`
   - **Start Command:** `npm start`
5. Under **Environment Variables**, add:
   - `HYPERBEAM_API_KEY`: *(Your key from hyperbeam.com)*
   - `MAX_ROOMS`: `2`
   - `PORT`: `10000` (or leave default, Render sets PORT automatically)
6. Click **Deploy**. Your app will be live at `https://your-app.onrender.com` with free HTTPS & WebSocket support!

#### Alternative: **Koyeb** (Free Nano Instance)
- Koyeb offers a free tier that doesn't sleep as quickly as Render.
- Build command: `npm run install:all && npm run build`
- Run command: `npm start`
- Add `HYPERBEAM_API_KEY` to environment variables.

## Tech Stack

| Layer    | Tech                              |
|----------|-----------------------------------|
| Frontend | Vite + Vanilla JS + CSS           |
| Backend  | Node.js + Express + ws (WebSocket)|
| Browser  | HyperBeam Virtual Browser API     |
| Chat     | Native WebSocket                  |
| Storage  | localStorage (usernames)          |

## Limits (Free Tier)

- Max **2 active rooms** at a time
- HyperBeam free tier session limits apply
- Rooms auto-close after 5 min of inactivity

## Project Structure

```
watchHyperBeam/
├── server/
│   ├── index.js        # Express + WebSocket server
│   ├── .env.example    # Environment variables template
│   └── package.json
├── client/
│   ├── src/
│   │   ├── main.js     # App logic & routing
│   │   ├── socket.js   # WebSocket client wrapper
│   │   ├── utils.js    # Helpers & toast
│   │   └── style.css   # Full UI styles
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```
