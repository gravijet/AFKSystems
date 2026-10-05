# API

Create a personal API token through the panel. Send it in the `Authorization: Bearer <token>` header. Tokens grant only the permissions attached to them and can be revoked.

The API supports bot status and start/stop operations. Request paths and validation are defined in the server routes; use the same identifiers shown in the panel.

Keep tokens in environment variables when writing scripts. Do not put them in source files or command examples.
