import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";
import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SQLite Database Setup
const dbPath = path.join(process.cwd(), "chat.db");
const sqlite = new Database(dbPath);

// Create messages table if it doesn't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    color TEXT NOT NULL
  )
`);

interface ChatMessage {
  id: string;
  user: string;
  text: string;
  timestamp: number;
  color: string;
}

const MAX_HISTORY = 100;
const messageHistory: ChatMessage[] = sqlite.prepare("SELECT * FROM messages ORDER BY timestamp DESC LIMIT ?")
  .all(MAX_HISTORY)
  .reverse() as ChatMessage[];

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  // WebSocket Server
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("New chat client connected");

    // Send history to new client
    ws.send(JSON.stringify({ type: "history", messages: messageHistory }));

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "chat") {
          const newMessage: ChatMessage = {
            id: Math.random().toString(36).substring(2, 11),
            user: message.user || "Anônimo",
            text: message.text,
            timestamp: Date.now(),
            color: message.color || "#10b981"
          };

          // Save to SQLite
          const insert = sqlite.prepare("INSERT INTO messages (id, user, text, timestamp, color) VALUES (?, ?, ?, ?, ?)");
          insert.run(newMessage.id, newMessage.user, newMessage.text, newMessage.timestamp, newMessage.color);

          // Update in-memory history
          messageHistory.push(newMessage);
          if (messageHistory.length > MAX_HISTORY) {
            messageHistory.shift();
            // Optional: Cleanup old messages from DB to keep it small
            // sqlite.prepare("DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY timestamp DESC LIMIT ?)").run(MAX_HISTORY);
          }

          // Broadcast to all clients
          const broadcastData = JSON.stringify({ type: "chat", message: newMessage });
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(broadcastData);
            }
          });
        }
      } catch (err) {
        console.error("WS message error:", err);
      }
    });
  });

  // Helper to fetch radio stats from Shoutcast JSON endpoint
  async function getRadioStats() {
    const statsUrl = process.env.RADIO_STATS_URL || `http://stm1.voxpainel.com.br:7076/stats?sid=1&json=1`;
    const radioName = process.env.VITE_RADIO_NAME || "Shekinah Fm";
    
    try {
      const response = await fetch(statsUrl, { 
        signal: AbortSignal.timeout(5000),
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Prioritize currentlisteners as requested by the user
        const listenersCount = data.currentlisteners !== undefined 
          ? data.currentlisteners 
          : (data.uniquelisteners || "0");

        return {
          song: data.songtitle || radioName,
          listeners: parseInt(String(listenersCount), 10) || 0
        };
      }
      
      return { song: radioName, listeners: 0 };
    } catch (err) {
      console.error("Stats fetch error:", err);
      return { song: radioName, listeners: 0 };
    }
  }

  // Health check
  app.get("/api/health", (req, res) => {
    const distPath = path.resolve(__dirname, 'dist');
    const distExists = fs.existsSync(distPath);
    res.json({ 
      status: "ok", 
      mode: process.env.NODE_ENV, 
      distExists,
      cwd: process.cwd(),
      dirname: __dirname
    });
  });

  // API Route to fetch the current song and listeners
  app.get("/api/current-song", async (req, res) => {
    const stats = await getRadioStats();
    res.json({
      ...stats,
      currentlisteners: stats.listeners
    });
  });

  // API Route to proxy the radio logo
  app.get("/api/logo", (req, res) => {
    const logoUrl = process.env.VITE_RADIO_LOGO_URL || "https://i1.sndcdn.com/avatars-000304126092-ysdpwc-t240x240.jpg";
    
    const proxyLogo = (url: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        res.status(500).send("Too many redirects");
        return;
      }

      const protocol = url.startsWith('https') ? https : http;
      const proxyReq = protocol.get(url, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://soundcloud.com/' // For soundcloud logos
        }
      }, (proxyRes) => {
        // Handle redirects
        if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          let nextUrl = proxyRes.headers.location;
          if (!nextUrl.startsWith('http')) {
            const parsedUrl = new URL(url);
            nextUrl = `${parsedUrl.protocol}//${parsedUrl.host}${nextUrl}`;
          }
          proxyLogo(nextUrl, redirectCount + 1);
          return;
        }

        res.setHeader("Content-Type", proxyRes.headers["content-type"] || "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=3600");
        proxyRes.pipe(res);
      });

      proxyReq.on("error", (err) => {
        console.error("Logo proxy error:", err);
        if (!res.headersSent) {
          res.status(500).send("Logo error");
        }
      });
    };

    proxyLogo(logoUrl);
  });

  // Dedicated API Route for current listeners only
  app.get("/api/listeners", async (req, res) => {
    const stats = await getRadioStats();
    res.json({ currentlisteners: stats.listeners });
  });

  // Proxy for the audio stream to bypass Mixed Content (HTTP on HTTPS site)
  app.get("/api/stream", (req, res) => {
    let streamUrl = process.env.VITE_RADIO_STREAM_URL || "http://stm6.voxhd.com.br:6780/;";
    
    // Shoutcast often needs the /; suffix to return the audio stream directly
    if (!streamUrl.endsWith(';') && !streamUrl.includes('?')) {
      streamUrl = streamUrl.endsWith('/') ? `${streamUrl};` : `${streamUrl}/;`;
    }

    const proxyStream = (url: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        res.status(500).send("Too many redirects");
        return;
      }

      console.log(`Proxying stream from: ${url} (attempt ${redirectCount + 1})`);
      const protocol = url.startsWith('https') ? https : http;
      
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'Accept': 'audio/mpeg, audio/*, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Icy-MetaData': '0',
          'Connection': 'close',
          'Referer': 'http://stm6.voxhd.com.br:6780/' // Some servers check referer
        },
        timeout: 30000
      };

      const proxyReq = protocol.get(url, requestOptions, (proxyRes) => {
        // Handle redirects internally
        if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          let nextUrl = proxyRes.headers.location;
          if (!nextUrl.startsWith('http')) {
            const parsedUrl = new URL(url);
            nextUrl = `${parsedUrl.protocol}//${parsedUrl.host}${nextUrl}`;
          }
          console.log(`Following redirect to: ${nextUrl}`);
          proxyStream(nextUrl, redirectCount + 1);
          return;
        }

        if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
          console.error(`Stream server returned error ${proxyRes.statusCode} for ${url}`);
          if (!res.headersSent) {
            res.status(proxyRes.statusCode).send(`Stream server error: ${proxyRes.statusCode}`);
          }
          return;
        }

        // Transfer relevant headers
        const contentType = proxyRes.headers["content-type"] || "audio/mpeg";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Connection", "keep-alive");
        
        Object.keys(proxyRes.headers).forEach(key => {
          if (key.startsWith('icy-') && key !== 'icy-metaint') {
            res.setHeader(key, proxyRes.headers[key] as string);
          }
        });
        
        proxyRes.pipe(res);

        // Handle client disconnect during stream
        req.on("close", () => {
          proxyRes.destroy();
          proxyReq.destroy();
        });
      });

      proxyReq.on("error", (err) => {
        console.error("Stream proxy request error:", err);
        if (!res.headersSent) {
          res.status(500).send("Stream connection error");
        }
      });
    };

    proxyStream(streamUrl);
  });

  // Vite middleware for development
  const distPath = path.resolve(__dirname, 'dist');
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(distPath);
  
  if (!isProduction) {
    console.log("Starting in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in PRODUCTION mode...");
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
