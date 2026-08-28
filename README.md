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

## Docker deployment

The repository contains a production Docker Compose stack with Angular, the Express API and MongoDB. It intentionally does not include a public reverse proxy; expose the configured frontend and backend host ports through the proxy already installed on the VPS.

```bash
cp .env.docker.example .env
# Fill every required secret and set FILE_STORAGE_HOST_PATH to the VPS HDD mount.
docker compose config
docker compose up -d --build
```

The frontend is published on port `4300` and the API on `4301` by default. MongoDB is only available on the private Compose network. Uploaded license and APK files are private and stored below `FILE_STORAGE_HOST_PATH`; downloads continue to use authenticated API endpoints.

Before starting the stack, create the host storage directory and make it writable by UID/GID `1000`, which is the unprivileged Node user inside the backend container. In Coolify, define the values from `.env.docker.example` as application environment variables and point `FILE_STORAGE_HOST_PATH` at the HDD mount.
