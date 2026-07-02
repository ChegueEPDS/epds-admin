# EPDS Admin Backend

Small Express API for the EPDS Admin app. It shares the existing EPDS auth data model and accepts Microsoft/Entra login only:

- `User`, `Tenant`, and `Session` Mongo collections
- `access_token`, `refresh_token`, and `csrf_token` cookies
- the existing `JWT_SECRET`, `JWT_AUDIENCE`, and `JWT_ISSUER`

Copy `.env.example` to `.env`, set `MONGODB_URI`, JWT settings, Microsoft login settings and Graph mail settings, then run:

```bash
npm install
npm run dev
```

The API listens on `http://localhost:4301` by default.
