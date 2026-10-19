import test from 'node:test';
import assert from 'node:assert/strict';
import { createLastfmClient, getListeningProfile } from '../src/lastfm.js';
import { chartFixture } from './fixtures.js';

const env = { LASTFM_API_KEY: 'private-fixture-key', LASTFM_DEFAULT_USER: 'rmlowe' };
const request = async (method, params) => chartFixture(method === 'user.getTopArtists' ? 'artist' : 'track', params);

test('bounded charts preserve numeric counts, coverage and periods without exposing credentials', async () => {
  const calls = [];
  const client = createLastfmClient(env, { fetcher: async (url, init) => {
    calls.push(url);
    assert.equal(url.origin, 'https://ws.audioscrobbler.com');
    assert.equal(url.searchParams.get('api_key'), env.LASTFM_API_KEY);
    assert.equal(init.redirect, 'manual');
    const kind = url.searchParams.get('method') === 'user.getTopArtists' ? 'artist' : 'track';
    return Response.json(chartFixture(kind, { limit: Number(url.searchParams.get('limit')), total: 500 }));
  } });
  const profile = await getListeningProfile({ period: '12month' }, client, env);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(u => u.searchParams.get('period') === '12month' && u.searchParams.get('page') === '1'));
  assert.equal(profile.artists.items[0].playcount, 42);
  assert.equal(profile.tracks.items[0].artist, 'Example Artist');
  assert.equal(profile.artists.coverage.truncated, true);
  assert.equal(profile.artists.coverage.totalEntries, 500);
  assert.ok(Number.isFinite(Date.parse(profile.retrievedAt)));
  assert.doesNotMatch(JSON.stringify(profile), /private-fixture-key/);
});

test('explicit username overrides owner; empty charts are a successful empty result', async () => {
  const result = await getListeningProfile({ username: 'other-user' }, async (method, params) => {
    assert.equal(params.user, 'other-user');
    return chartFixture(method === 'user.getTopArtists' ? 'artist' : 'track', { ...params, total: 0 });
  }, env);
  assert.equal(result.username, 'other-user');
  assert.deepEqual(result.artists.items, []);
  assert.equal(result.tracks.coverage.truncated, false);
});

test('invalid inputs and missing default are rejected before upstream requests', async () => {
  let calls = 0;
  const never = () => { calls++; throw new Error('must not fetch'); };
  for (const input of [{ period: 'month' }, { artistLimit: 51 }, { trackLimit: 101 }, { artistLimit: 0 },
    { trackLimit: 1.5 }, { username: 'user&api_key=bad' }]) {
    await assert.rejects(getListeningProfile(input, never, env));
  }
  await assert.rejects(getListeningProfile({}, never), { code: 'not_configured' });
  assert.equal(calls, 0);
});

test('malformed or mismatched charts fail instead of inventing zero counts', async () => {
  for (const mutate of [
    x => { delete x.topartists.artist; },
    x => { x.topartists.artist[0].playcount = 'NaN'; },
    x => { delete x.topartists.artist[0].playcount; },
    x => { x.topartists['@attr'].user = 'another-user'; },
    x => { x.topartists['@attr'].page = '2'; },
    x => { x.topartists['@attr'].total = '-1'; },
    x => { x.topartists.artist = []; },
  ]) {
    await assert.rejects(getListeningProfile({}, async (method, params) => {
      const data = await request(method, params);
      if (data.topartists) mutate(data);
      return data;
    }, env), { code: 'invalid_response' });
  }
});

test('HTTP and Last.fm API failures are sanitized, never successful empty profiles', async () => {
  for (const [status, body, code] of [
    [302, {}, 'upstream_error'], [500, {}, 'upstream_error'], [429, {}, 'rate_limited'],
    [200, { error: 29 }, 'rate_limited'], [200, { error: 10 }, 'api_key_rejected'],
    [200, { error: 26 }, 'api_key_rejected'], [200, { error: 6 }, 'profile_unavailable'],
    [200, { error: 11 }, 'upstream_error'],
  ]) {
    let calls = 0;
    const client = createLastfmClient(env, { fetcher: async () => {
      calls++; return Response.json({ ...body, message: env.LASTFM_API_KEY }, { status });
    } });
    await assert.rejects(client('user.getTopArtists', {}), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private-fixture-key/);
      return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(createLastfmClient(env, { fetcher: async () => new Response('not JSON') })('user.getTopArtists', {}), { code: 'invalid_response' });
  await assert.rejects(createLastfmClient(env, { fetcher: async () => { throw new Error(env.LASTFM_API_KEY); } })('user.getTopArtists', {}), { code: 'upstream_error', message: 'Unable to contact Last.fm.' });
  await assert.rejects(createLastfmClient({})('user.getTopArtists', {}), { code: 'not_configured' });
});

test('timeout covers fetch and body consumption; a failed chart fails the whole profile', async () => {
  const client = createLastfmClient(env, { timeoutMs: 5, fetcher: async (_url, { signal }) => ({
    ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  }) });
  await assert.rejects(client('user.getTopArtists', {}), { code: 'timeout' });
  await assert.rejects(getListeningProfile({}, async (method, params) => {
    if (method === 'user.getTopTracks') throw new Error('chart failed');
    return request(method, params);
  }, env), /chart failed/);
});
