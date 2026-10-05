import rateLimit from 'express-rate-limit';

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // 5 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas requisições enviadas a partir deste IP. Por favor, aguarde um momento antes de fazer uma nova pergunta.'
  }
});