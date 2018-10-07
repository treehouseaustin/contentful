const _ = require('lodash');
const manager = require('cache-manager');

const ROUTE_KEY = '$routes';
const TYPE_KEY = '$types';

/**
 * In addition to caching the individual entries, the cache service also
 * maintains a mapping of the routes and content types for a wholistic
 * representation of the data in Contentful.
 */
class CacheService {
  /**
   * @param {Object} config Configuration for the cache store. Default
   * behaviour is to use a memory store. Documented options can be found here:
   * https://github.com/BryanDonovan/node-cache-manager
   */
  constructor(config = {}) {
    this.cache = manager.caching({store: 'memory', ...config});
    this.lang = config.lang || 'en-US';
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
  update(entry) {
    this.cache.set(entry.sys.id, entry);
    this.onUpdate(entry);
    return entry;
  }

  /**
   * Batch update entries as well as the route and content type mappings.
   * @param {Array} entries - A page of entries returned from the API.
   */
  async updateEntries(entries) {
    const routes = entries.filter(({fields}) => !!fields.slug)
        .reduce((all, {fields, sys}) => {
          all[fields.slug[this.lang]] = [sys.contentType.sys.id, sys.id];
          return all;
        }, {});

    this.updateRoutes(routes);

    // Build an internal mapping of content types to their entries. This is used
    // when calling `entriesOfType` to improve performance on large datasets.
    let types = await this.cache.get(TYPE_KEY) || {};

    entries.map((entry) => {
      let contentType = entry.sys.contentType;
      types[contentType.sys.id] = types[contentType.sys.id] || [];
      if (!types[contentType.sys.id].includes(entry.sys.id)) {
        types[contentType.sys.id].push(entry.sys.id);
      }

      // Update the single entry in cache.
      this.update(entry);
    });

    await this.cache.set(TYPE_KEY, types);
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
    let entry = await this.entry(entryId);
    const type = entry.sys.contentType.sys.id;

    this.cache.del(entryId);
    this.onDestroy(entryId);
    this.deleteRoute(entryId);

    // Remove the content type mapping if one exists for this entry.
    const cachedTypes = await this.cache.get(TYPE_KEY);
    if (!cachedTypes || !cachedTypes[type]) return;
    cachedTypes[type] = cachedTypes[type].filter((id) => id !== entry.sys.id);
    this.cache.set(TYPE_KEY, cachedTypes);
  }

  /**
   * Get a single entry from cache.
   * @param {String} entryId - The Contentful entry ID.
   * @return {Promise} Fulfilled with the cached entry.
   */
  entry(entryId) {
    return this.cache.get(entryId);
  }

  /**
   * Get all entries matching a particular content model in Contentful.
   * By default all entries are stored in a keyed object. This converts the
   * cached entry into an array which can be iterated through in a view.
   * @param {String|Array} types The Content Model type(s) to include.
   * @param {Function} filter An option filter callback passed to lodash.
   * @return {Array} All matching entries.
   */
  async entriesOfType(types, filter) {
    if (typeof types === 'string') types = [types];
    let entries = [];

    const existing = await this.cache.get(TYPE_KEY) || {};
    _.each(types, (type) => {
      existing[type] = existing[type] || [];
      entries = entries.concat(existing[type]);
    });

    if (filter) {
      entries = _.filter(entries, filter);
    }

    return Promise.all(entries.map((id) => this.entry(id)));
  }

  // Routing
  // --

  /**
   * Get all routes that have been registered for content.
   * @return {Promise} Fulfilled with the cache contents.
   */
  async routes() {
    return await this.cache.get(ROUTE_KEY) || {};
  }

  /**
   * Update internal routing cache with new content.
   * @param {Object} routes - New routes to be merged.
   * @param {Boolean} merge - Whether to use a merge or replace strategy.
   * @return {Promise}
   */
  async updateRoutes(routes, merge = true) {
    if (!merge) {
      return this.cache.set(ROUTE_KEY, routes);
    }
    let existing = await this.routes();
    return this.cache.set(ROUTE_KEY, {
      ...existing,
      ...routes,
    });
  }

  /**
   * Delete a route by the content ID. Used when the content has been deleted
   * to prevent cached routes from sending users to a broken page.
   * @param {String} entryId - The Contentful entry ID.
   */
  async deleteRoute(entryId) {
    let routes = await this.routes();
    const key = _.findKey(routes, (val) => val[1] === entryId);
    if (!key) return;
    delete routes[key];
    this.cache.set(ROUTE_KEY, routes);
  }
};

module.exports = CacheService;
