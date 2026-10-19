import { Vault, fault } from "./store.mjs";
import { auth, body, json, serve } from "./http.mjs";
import { Ledger } from "./ledger.mjs";
import { readFileSync } from "node:fs";
export function application({ vault, accounts }) {
  const ledger = new Ledger(vault);
  return async (req, res) => {
    const url = new URL(req.url, "http://local");
    if (req.method === "GET" && url.pathname === "/healthz")
      return json(res, 200, { status: "ok" });
    if (req.method === "GET" && url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      return res.end(
        readFileSync(new URL("../public/index.html", import.meta.url)),
      );
    }
    let tenant;
    for (const [id, token] of Object.entries(accounts)) {
      try {
        auth(req, token);
        tenant = id;
        break;
      } catch {}
    }
    if (!tenant) throw fault("authentication_required", 401);
    if (req.method === "GET" && url.pathname === "/operations")
      return json(res, 200, ledger.view(tenant));
    if (
      req.method === "POST" &&
      [
        "/imports/executions",
        "/imports/merchant-events",
        "/imports/activity",
      ].includes(url.pathname)
    ) {
      const input = await body(req, 4 * 1024 * 1024);
      return json(
        res,
        200,
        await ledger.import(
          tenant,
          url.pathname.split("/").at(-1),
          input.events,
        ),
      );
    }
    const match = url.pathname.match(/^\/cases\/([^/]+)\/resolve$/);
    if (req.method === "POST" && match) {
      const i = await body(req);
      return json(
        res,
        200,
        await ledger.resolve(
          tenant,
          decodeURIComponent(match[1]),
          i.action,
          i.reason,
          i.evidence,
        ),
      );
    }
    const op = url.pathname.match(/^\/operations\/([^/]+)$/);
    if (req.method === "GET" && op) {
      const item = ledger
        .view(tenant)
        .operations.find((x) => x.id === decodeURIComponent(op[1]));
      return json(res, item ? 200 : 404, item || { error: "not_found" });
    }
    throw fault("not_found", 404);
  };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const accounts = JSON.parse(process.env.ACCOUNTS_JSON || "{}");
  if (!Object.keys(accounts).length) throw Error("ACCOUNTS_JSON required");
  serve(
    application({
      vault: new Vault(process.env.DATA_DIR || ".data", process.env.DATA_KEY),
      accounts,
    }),
    Number(process.env.PORT || 4403),
  );
}
