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

  it('caches routes', async () => {
    await store.cache.updateEntries(fixture);
    let routes = await store.cache.routes();

    expect(Object.keys(routes).length).toBe(11);
    expect(Array.isArray(routes['terms-conditions'])).toBe(true);
    expect(routes['terms-conditions'].length).toBe(2);
  });

  it('caches content types', async () => {
    let types = await store.cache.entriesOfType('press');
    expect(types.length).toBe(8);
    expect(types[0].fields).toBeDefined();
  });

  it('allows lookup of multiple content types', async () => {
    let types = await store.cache.entriesOfType(['press', 'page']);
    expect(types.length).toBe(9);
  });

  it('deletes an entry and associated mappings', async () => {
    let types = await store.cache.entriesOfType('press');
    await store.cache.destroy(types[0].sys.id);
    let routes = await store.cache.routes();
    expect(Object.keys(routes).length).toBe(10);
    types = await store.cache.entriesOfType('press');
    expect(types.length).toBe(7);
  });
});
