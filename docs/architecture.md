# Architecture

The Node.js panel stores accounts, bot sessions and billing records. Each active session starts a separate client process and exchanges chat and commands over standard streams.

Remote agents run client processes on other machines. The panel controls their capacity and distributes client updates. A new client binary does not replace a running process until that session restarts.

Billing uses integer credits. Plan limits and enabled features are checked before starting sessions. Payment processing and receipts are handled by the server.

`data/` holds the database, downloaded clients, account credentials, logs and backups. Keep that directory private and outside published source archives.
