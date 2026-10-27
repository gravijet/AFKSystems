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

To exercise four real client processes against an isolated loopback Minecraft server:

```sh
AFK_TEST_CLIENT=/path/to/afk-linux node --test test/multi-account-client.test.js
```

This verifies join commands, per-account chat, and timer changes using the packets received by the test server. The test uses temporary accounts and a temporary database.

`JOIN_SPACING_MS` sets the minimum spacing between client starts for the same host and port (default: 3000 ms). Queued accounts count toward capacity and can be stopped. Chat requests wait for each client's input write and return individual failures; this confirms handoff to the client, while execution still depends on the Minecraft server. Retrying a partial chat send targets the failed accounts.

The panel starts separate client processes and communicates through standard input and output. Features depend on the installed client build. Configure the client repository and any payment, mail or Discord integrations locally.

Source is split between `server/`, `public/`, `agent/` and `bot/`. See [docs](docs/README.md) for the API and configuration notes.
