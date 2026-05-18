import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { routeOptimizationRouter } from './routes/api';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', routeOptimizationRouter);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Frontend dosyalarını servis et
// __dirname: backend/dist → ../../frontend = proje kökü/frontend
const frontendPath = path.resolve(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendPath));

// SPA fallback
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server çalışıyor: http://localhost:${PORT}`);
});
