const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/webhookTestController');

const router = express.Router();
const receiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
});
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/inboxes/:token', receiveLimiter, express.raw({ type: '*/*', limit: '256kb' }), controller.receive);
router.get('/inboxes/:token/requests', readLimiter, controller.list);
router.delete('/inboxes/:token/requests', readLimiter, controller.clear);

module.exports = router;
