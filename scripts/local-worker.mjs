// Local development entry point. Do not deploy this file.
import worker from "../dist/server/index.js";

export default {
  async fetch(request, env, ctx) {
    const headers = new Headers(request.headers);
    headers.set("oai-authenticated-user-id", "local-user");
    return worker.fetch(new Request(request, { headers }), env, ctx);
  },
};
