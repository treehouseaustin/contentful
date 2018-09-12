const Contentful = require('../');

describe('routing', () => {
  let store;
  beforeEach(() => {
    store = new Contentful('0wm9nswht8zw');
  });

  it('caches routes', () => {
    expect(store.space).toBe('0wm9nswht8zw');
  });
});
