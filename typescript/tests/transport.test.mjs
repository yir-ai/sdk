import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createNodeHttpTransport, YirAPIError } from "../dist/index.js";

test("real HTTP redirects never replay a generation or forward its authorization", async t => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, method: request.method });
    request.resume();
    response.writeHead(Number(request.url.slice(1)) || 200, {
      Location: "/replayed", "Content-Type": "application/json",
    });
    response.end('{"id":"1"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  const transport = createNodeHttpTransport({ apiKey: "fixture", baseURL: `http://127.0.0.1:${server.address().port}` });
  for (const status of [301, 302, 303, 307, 308]) {
    await assert.rejects(transport({ method: "POST", path: `/${status}`,
      headers: { "Idempotency-Key": "persisted-request" }, body: { model: "fixture" } }));
  }
  assert.deepEqual(requests, [301, 302, 303, 307, 308].map(status => ({ path: `/${status}`, method: "POST" })));
});

test("invalid success bodies and malformed JSON errors are read once without retry", async () => {
  for (const fixture of [
    { status: 200, contentType: "application/json", body: "{" },
    { status: 200, contentType: "text/html", body: "<html>proxy</html>" },
    { status: 502, contentType: "application/json", body: "{proxy failure" },
  ]) {
    let requests = 0;
    const transport = createNodeHttpTransport({ apiKey: "fixture", fetch: async () => {
      requests++;
      return new Response(fixture.body, { status: fixture.status, headers: { "Content-Type": fixture.contentType } });
    } });
    await assert.rejects(transport({ method: "POST", path: "/v1/images/generations", body: {} }), error => {
      if (fixture.status === 200) assert.equal(error.message, "response_invalid");
      else { assert.ok(error instanceof YirAPIError); assert.equal(error.status, 502); }
      return true;
    });
    assert.equal(requests, 1);
  }
});
