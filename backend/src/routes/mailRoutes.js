const express = require('express');
const controller = require('../controllers/mailController');
const { requireAuth, requireEpdsEmail } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/mail/send', requireAuth, requireEpdsEmail, controller.sendMail);
router.get('/mailbox', requireAuth, requireEpdsEmail, controller.listMailboxMessages);
router.get('/mailbox/:id', requireAuth, requireEpdsEmail, controller.getMailboxMessage);

module.exports = router;
