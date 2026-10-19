export function chartFixture(kind, { user = 'rmlowe', limit = kind === 'artist' ? 30 : 50, total = 1 } = {}) {
  return { [kind === 'artist' ? 'topartists' : 'toptracks']: {
    [kind]: total === 0 ? [] : [{ name: kind === 'artist' ? 'Example Artist' : 'Example Track',
      playcount: '42', '@attr': { rank: '1' }, artist: { name: 'Example Artist' } }],
    '@attr': { user, page: '1', perPage: String(limit), totalPages: String(Math.ceil(total / limit)), total: String(total) },
  } };
}
