import { initBotId } from "botid/client/core";

// Server Actions são POSTs na própria página que as chama.
initBotId({
  protect: [
    { path: "/eventos/*/checkout", method: "POST" },
    { path: "/pedidos/*", method: "POST" },
  ],
});
