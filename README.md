# AFKSystems

Web panel for Minecraft AFK clients. Manage accounts, bot sessions, chat, commands, remote agents and billing.

## Development

```sh
npm install
npm install --prefix bot
cp .env.example .env
npm start
```

Set the required values in `.env`. The first registered user becomes an administrator unless `ADMIN_EMAIL` selects one explicitly. Keep registration private until that account exists.

```sh
npm test
```

The panel starts separate client processes and communicates through standard input and output. Features depend on the installed client build. Configure the client repository and any payment, mail or Discord integrations locally.

Source is split between `server/`, `public/`, `agent/` and `bot/`. See [docs](docs/README.md) for the API and configuration notes.
