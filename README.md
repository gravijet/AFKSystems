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
AFK_TEST_CLIENT=/path/to/premium-items-afk-linux node --test test/multi-account-client.test.js
```

This verifies join commands, per-account chat, queued commands across world changes and TCP transfers, timer changes and isolated Home settings with four Premium/Items clients. The test uses temporary accounts, a temporary database and packets received by the test server.

`JOIN_SPACING_MS` sets the minimum spacing between client starts for the same host and port (default: 3000 ms). Queued accounts count toward capacity and can be stopped. Chat requests wait for each client's input write and return individual failures; this confirms handoff to the client, while execution still depends on the Minecraft server. Retrying a partial chat send targets the failed accounts.

The panel starts separate client processes and communicates through standard input and output. Features depend on the installed client build. Configure the client repository and any payment, mail or Discord integrations locally.

Client settings now live under `data/users/<user>/bots/<profile>-<account>/afksystems/`. Microsoft logins remain shared through the canonical `afksystems/accounts/` directory; Home positions and routes are isolated. The previous user-wide `movement.json` is retained but cannot be assigned reliably to a server/account, so configure Home and routes once for the intended bot. Remote locations need Agent 1.2.0 (`deploy/install-agent.sh`); older agents cannot start scoped jobs.

The scoreboard tab refreshes every online account every five seconds while visible. A pipe write confirms acceptance by the client, not execution by the Minecraft server. Reward behavior must be checked separately using fresh per-account server responses; the earlier WindSMP observation alone does not prove a universal one-account-per-IP limit.

Source is split between `server/`, `public/`, `agent/` and `bot/`. See [docs](docs/README.md) for the API and configuration notes.

All macros, including join commands, are now managed by the panel in a separate queue per profile/account. Join macros use the configured start delay and execute in ID order before subsequently triggered macros. Edits apply to the next join without restarting the client. Stop/restart aborts sleeping and pending runs. Client 2.8.2 preserves unsent commands during subserver changes and intentional transfers, while a real disconnect invalidates them instead of replaying them after a kick.

The investigation and acceptance criteria are recorded in [the multi-account repair plan](docs/multi-account-repair-plan.md).
