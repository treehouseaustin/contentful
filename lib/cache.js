const {promisify} = require('util');
const redis = require('redis');

const ROUTE_KEY = '$routes';
const TYPE_KEY = '$type';

/**
 * In addition to caching the individual entries, the cache service also
 * maintains a mapping of the routes and content types for a wholistic
 * representation of the data in Contentful.
 */
class CacheService {
  /**
   * @param {Object} config Configuration for the Redis client.
   */
  constructor(config = {}) {
    this.client = redis.createClient(config);
    this.lang = config.lang || 'en-US';

    this.client.on('error', console.error);
    ['exec', 'get', 'smembers'].map((cmd) => {
      this.client[cmd] = promisify(this.client[cmd]).bind(this.client);
    });
  }

  // Entries
  // --

  /**
   * Override this in your implementation if you need to perform logic in your
   * application once a record cache has been created or updated. Otherwise,
   * just use `cache.get` to retrieve entries from cache or API.
   */
  onUpdate() {}

  /**
   * Update the internal cache with an entry returned from the API.
   * @param {Object} entry - Contentful entry from the API.
   * @return {Object} - The original raw entry.
   */
  async update(entry) {
    const transaction = this.client.multi();

    // Build an internal mapping of content types to their entries. This is used
    // when calling `entriesOfType` to improve performance on large datasets.
    const type = entry.sys.contentType.sys.id;
    transaction.sadd([TYPE_KEY, type].join('.'), entry.sys.id);

    // If the entry includes a slug, update internal routing map.
    const route = entry.fields.slug && entry.fields.slug[this.lang];
    if (route) {
      transaction.sadd(ROUTE_KEY, [route, type, entry.sys.id].join(':'));
    }

    transaction.set(entry.sys.id, JSON.stringify(entry));
    await transaction.exec();

    this.onUpdate(entry);
    return entry;
  }

  /**
   * Batch update entries as well as the route and content type mappings.
   * @param {Array} entries - A page of entries returned from the API.
   */
  async updateEntries(entries) {
    return Promise.all(entries.map((entry) => this.update(entry)));
  }

  /**
   * Override this in your implementation if you need to perform logic in your
   * application once a record has been removed from cache. This will not be
   * called when a record has expired or if you use `cache.del` manually.
   */
  onDestroy() {}

  /**
   * Remove an entry from cache including it's route. This is typically used
   * to unpublish an entry in production but can be triggered manually also.
   * @param {Object} entryId - ID of the Contentful entry.
   */
  async destroy(entryId) {
    const entry = await this.entry(entryId);
    if (!entry || !entry.sys) return;

    const type = entry.sys.contentType.sys.id;

    const transaction = this.client.multi();
    transaction.del(entryId);
    transaction.srem([TYPE_KEY, type].join('.'), entry.sys.id);

    // If the entry includes a slug, update internal routing map.
    const route = entry.fields.slug && entry.fields.slug[this.lang];
    if (route) {
      transaction.srem(ROUTE_KEY, [route, type, entry.sys.id].join(':'));
    }

    await transaction.exec();

    this.onDestroy(entryId);
    return entryId;
  }

  /**
   * Get a single entry from cache.
   * @param {String} entryId - The Contentful entry ID.
   * @return {Promise} Fulfilled with the cached entry.
   */
  async entry(entryId) {
    const entry = await this.client.get(entryId);
    return JSON.parse(entry) || {};
  }

  /**
   * Get all entries matching a particular content model in Contentful.
   * By default all entries are stored in a keyed object. This converts the
   * cached entry into an array which can be iterated through in a view.
   * @param {String|Array} types The Content Model type(s) to include.
   * @return {Array} All matching entries.
   */
  async entriesOfType(types) {
    if (typeof types === 'string') types = [types];
    let entries = [];

    entries = await Promise.all(types.map((type) => {
      return this.client.smembers([TYPE_KEY, type].join('.'));
    }));

    return Promise.all([].concat(...entries).map((id) => this.entry(id)));
  }

  // Routing
  // --

  /**
   * Get all routes that have been registered for content.
   * @return {Promise} Fulfilled with the cache contents.
   */
  async routes() {
    const routes = await this.client.smembers(ROUTE_KEY) || {};
    return routes.reduce((result, route) => {
      const [slug, type, uuid] = route.split(':');
      result[slug] = [type, uuid];
      return result;
    }, {});
  }
};

module.exports = CacheService;
