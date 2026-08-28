const express = require('express');
const multer = require('multer');
const { requireAuth, requireSuperAdmin } = require('../middlewares/authMiddleware');
const { analyzeFit, modifyFit } = require('../services/fitFileService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, /\.fit$/i.test(file.originalname))
});

router.post('/admin/fit/analyze', requireAuth, requireSuperAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'FIT fájl feltöltése kötelező.' });
    return res.json(await analyzeFit(req.file.buffer));
  } catch (error) {
    return res.status(422).json({ error: error.message || 'A FIT fájl nem dolgozható fel.' });
  }
});

router.post('/admin/fit/modify', requireAuth, requireSuperAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'FIT fájl feltöltése kötelező.' });
    const options = JSON.parse(req.body.options || '{}');
    const output = await modifyFit(req.file.buffer, options);
    const baseName = req.file.originalname.replace(/\.fit$/i, '');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}-modified.fit"`);
    return res.send(output);
  } catch (error) {
    return res.status(422).json({ error: error.message || 'A FIT fájl módosítása sikertelen.' });
  }
});

router.post('/admin/fit/preview', requireAuth, requireSuperAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'FIT fájl feltöltése kötelező.' });
    const options = JSON.parse(req.body.options || '{}');
    const output = await modifyFit(req.file.buffer, options);
    return res.json(await analyzeFit(output));
  } catch (error) {
    return res.status(422).json({ error: error.message || 'A FIT előnézet elkészítése sikertelen.' });
  }
});

module.exports = router;
