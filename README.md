# EPDS Admin

Standalone admin app split into two projects:

- `backend`: Express API using the existing EPDS-style cookie/session auth model.
- `frontend`: Angular Material UI with login, function cards, mail and domain-health pages.

## Development

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

The frontend runs on `http://localhost:4300` and expects the API on `http://localhost:4301` by default.
