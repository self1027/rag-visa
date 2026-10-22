import { settings } from '../config/settings.js';
import rateLimit from 'express-rate-limit';

export const chatLimiter = rateLimit({
  windowMs: settings.rateLimitWindowMs,
  max: settings.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas requisições enviadas a partir deste IP. Por favor, aguarde um momento antes de fazer uma nova pergunta.'
  }
});