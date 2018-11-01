const Contentful = require('../');
const fixture = require('./fixtures/sync-page.json');

describe('cache service', () => {
  let store;
  beforeAll((done) => {
    store = new Contentful('0wm9nswht8zw', {
      cache: {
        db: 0,
        port: 32768,
      },
    });
    store.cache.client.flushdb((err) => done(err));
  });

  afterAll((done) => {
    store.cache.client.quit((err) => done(err));
  });

  it('wraps entries', async () => {
    await store.cache.update(fixture[0]);
    entry = await store.entry(fixture[0].sys.id);

    expect(typeof entry).toBe('object');
    expect(entry.title).toEqual(fixture[0].fields.title['en-US']);
  });
});
