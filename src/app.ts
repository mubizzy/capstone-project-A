import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { errorHandler } from './middleware/errorHandler';
// Import event listeners so they register on startup
import './events/auth.events';
import authRoutes from './routes/auth';
// Add to src/app.ts
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import documentRoutes from './routes/documents';
// vitest.setup.ts
import dotenv from 'dotenv';
dotenv.config();









// Import routes (you will create these in upcoming lessons)
// import { authRoutes } from './routes/auth.routes';

const app = express();

// === MIDDLEWARE (runs on every request) ===
app.use(helmet());              // Security headers
app.use(cors());                // Cross-origin requests
app.use(express.json());        // Parse JSON request bodies

// === REQUEST LOGGING ===
app.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

app.get('/', (req, res) => {
  res.send('Hello World');
});

// === HEALTH CHECK ===
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.NODE_ENV,
  });
});

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Also serve the raw JSON spec (useful for code generators)
app.get('/api-docs.json', (req, res) => {
  res.json(swaggerSpec);
});
app.use('/api/auth', authRoutes);





// === ROUTES (mounted here as you build them) ===
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/documents', documentRoutes);
// app.use('/api/v1/conversations', conversationRoutes);

// === ERROR HANDLER (must be last middleware) ===
app.use(errorHandler);



export { app };
