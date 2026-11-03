import test from "node:test";
import assert from "node:assert/strict";
import { GitHubArchive } from "../dist/apps/server/src/publish/github.js";
const sha = "a".repeat(40),
  blob = "b".repeat(40);
const artifact = {
  path: "reports/2026/11/03/opensource/v000001.json",
  content: '{"fixture":true}\n',
  hash: "test",
};
const target = { repository: "owner/archive", branch: "reports" };
function setup(existing, failPut = false) {
  const calls = [];
  let saved = existing;
  let commits = 0;
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path.includes("/git/ref/"))
      return Response.json({ object: { type: "commit", sha } });
    if (path.includes("/contents/") && init.method === "GET")
      return saved === undefined
        ? new Response("{}", { status: 404 })
        : Response.json({
            type: "file",
            encoding: "base64",
            size: Buffer.byteLength(saved),
            sha: blob,
            content: Buffer.from(saved).toString("base64"),
          });
    if (path.endsWith("/commits"))
      return Response.json([
        { sha, commit: { committer: { date: "2026-11-03T01:00:00Z" } } },
      ]);
    if (init.method === "PUT") {
      commits++;
      saved = artifact.content;
      if (failPut) throw Error("network uncertain SECRET");
      return Response.json(
        { commit: { sha, committer: { date: "2026-11-03T01:00:00Z" } } },
        { status: 201 },
      );
    }
    throw Error("unexpected");
  };
  return {
    adapter: new GitHubArchive(target, "SECRET", fetcher),
    calls,
    get commits() {
      return commits;
    },
  };
}
test("create-only GitHub archive sends only artifact and no update sha; identical retry resolves existing commit", async () => {
  const s = setup();
  const first = await s.adapter.publish(artifact, new AbortController().signal);
  const second = await s.adapter.publish(
    artifact,
    new AbortController().signal,
  );
  assert.equal(first.sha, sha);
  assert.equal(second.sha, sha);
  assert.equal(s.commits, 1);
  const body = JSON.parse(
    s.calls.find((c) => c.init.method === "PUT").init.body,
  );
  assert.equal(body.branch, "reports");
  assert.equal(body.sha, undefined);
  assert.equal(
    Buffer.from(body.content, "base64").toString(),
    artifact.content,
  );
  assert.ok(s.calls.every((c) => c.init.redirect === "error"));
});
test("remote commit followed by lost response is reconciled without extra commit", async () => {
  const s = setup(undefined, true);
  await assert.rejects(
    s.adapter.publish(artifact, new AbortController().signal),
    /github_unavailable/,
  );
  assert.equal(
    (await s.adapter.publish(artifact, new AbortController().signal)).sha,
    sha,
  );
  assert.equal(s.commits, 1);
});
test("different bytes at same version never overwrite remote history", async () => {
  const s = setup("different");
  await assert.rejects(
    s.adapter.publish(artifact, new AbortController().signal),
    /archive_conflict/,
  );
  assert.equal(s.commits, 0);
});
test("GitHub status and missing branch are safe, bounded failures", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const s = new GitHubArchive(
      target,
      "SECRET",
      async () => new Response("SECRET private body", { status }),
    );
    await assert.rejects(
      s.publish(artifact, new AbortController().signal),
      new RegExp(`github_http_${status}`),
    );
  }
});
test('byte comparison rejects invalid UTF-8 that decodes to the same replacement character',async()=>{
 const a={...artifact,content:'\ufffd'};
 const adapter=new GitHubArchive(target,'SECRET',async(url)=>{
  if(new URL(url).pathname.includes('/git/ref/'))return Response.json({object:{type:'commit',sha}});
  if(new URL(url).pathname.includes('/contents/'))return Response.json({type:'file',encoding:'base64',content:Buffer.from([255]).toString('base64')});
  return Response.json([{sha,commit:{committer:{date:'2026-11-03T01:00:00Z'}}}]);
 });
 await assert.rejects(adapter.publish(a,new AbortController().signal),/archive_conflict/);
});
