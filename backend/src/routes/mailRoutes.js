const express = require('express');
const controller = require('../controllers/mailController');
const { requireAuth, requireTenantFeature } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/mail/send', requireAuth, requireTenantFeature('mail', 'edit'), controller.sendMail);
router.get('/mailbox', requireAuth, requireTenantFeature('mail'), controller.listMailboxMessages);
router.get('/mailbox/:id', requireAuth, requireTenantFeature('mail'), controller.getMailboxMessage);

module.exports = router;
