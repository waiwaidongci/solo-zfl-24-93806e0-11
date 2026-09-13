import { openDb } from "./src/db.js";
import { createApp } from "./src/app.js";

const port = Number(process.env.PORT || 3024);
const db = openDb(process.env.DB_FILE || undefined);
const server = createApp(db);

server.listen(port, () => console.log(`Racing pigeon registry + auction app listening on http://localhost:${port}`));
