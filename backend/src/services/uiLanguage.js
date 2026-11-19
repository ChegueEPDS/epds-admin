function requestLanguage(req) {
  const explicit = req.body?.language;
  if (explicit === 'en' || explicit === 'hu') return explicit;
  return req.acceptsLanguages?.('en', 'hu') === 'hu' ? 'hu' : 'en';
}

module.exports = { requestLanguage };
