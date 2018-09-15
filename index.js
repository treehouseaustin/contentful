const _ = require('lodash');
const cache = require('cache-manager');
const contentful = require('contentful');

const ContentfulWrapper = require('./lib/wrapper.js');
const embed = require('./lib/embed-asset.js');

/**
 * The Contentful cache store can be used to keep a local copy of all entries in
 * the CMS. This is useful to keep response times and API utilization low while
 * keeping content as up-to-date as possible.
 *
 * In addition to cache capabilities, each entry is wrapped in a set of
 * convenience functions and helper properties to make interaction with the
 * content easier in server-side views.
 */
class ContentfulCache {
  /**
   * Create a new Contentful cache store linked to a single `space`.
   * @param {String} space - The Contentful space ID.
   * @param {Object} config - Configuration for the cache store.
   * @param {Object} config.cache - Configuration for the cache store. Default
   * behaviour is to use a memory store. Documented options can be found here:
   * https://github.com/BryanDonovan/node-cache-manager
   * @param {Object} config.wrapper - Options to pass to the Contentful Wrapper
   * service. Among other things this will allow you to overwrite the Markdown
   * settings and map URLs to their content types when fetching slugs.
   * @param {String} config.env - The environment controls whether the Live or
   * Preview APIs are used to fetch from Contentful. Defaults to the value of
   * `process.env.NODE_ENV`.
   */
  constructor(space, config = {}) {
    this.cache = cache.caching(config.cache || {
      store: 'memory',
    });

    this.space = space;
    this.accessToken = config.accessToken;
    this.previewToken = config.previewToken;
    this.lang = config.lang || 'en-US';

    this.wrapperConfig = config.wrapper || {};
    this.wrapperConfig.spaceId = this.space;

    this.env = config.env || process.env.NODE_ENV;
    this.isProd = this.env === 'production';
  }

  /**
   * Initialize the API client which is used for communication with Contentful.
   * Repeated calls to `.client()` after the Contentful client has been created
   * will return a cached instance.
   * @return {Object} - Contentful API client.
   */
  client() {
    if (this.connect) return this.connect;

    // When running in `development` mode, the Contentful API client will
    // automatically switch over to Preview mode. This displays both published
    // and unpublished content. It is important that the access token be set
    // properly (Preview vs. Production) based on the environment.
    const accessToken = this.isProd ? this.accessToken : this.previewToken;
    const host = !this.isProd ? 'preview.contentful.com' : null;

    this.connect = contentful.createClient({
      accessToken,
      host,
      resolveLinks: false,
      space: this.space,
    });

    return this.connect;
  }

  /**
   * Retrieve a single asset by it's UUID. The asset will be wrapped in an embed
   * decorator which could be a function or a string depending on the file type.
   * @param {String} assetId - Contentful asset UUID.
   * @return {Promise} - Resolved with the embed decorator.
   */
  asset(assetId) {
    return this.cache.wrap(`asset.${assetId}`, () => {
      return this.client().getAsset(assetId);
    }).then((asset) => {
      return embed(asset.fields.file, this.wrapperConfig);
    });
  }

  /**
   * Retrieve multiple assets by their UUID. Each asset will be returned as a
   * keyed object where the ID of the image is it's key and the value is wrapped
   * in an embed decorator based on the file type.
   * @param {Array} assetIds - Multiple contentful asset UUIDs.
   * @return {Promise} - Resolved with all images in an object.
   */
  assets(assetIds) {
    return this.client().getAssets({
      'sys.id[in]': assetIds.join(','),
      'locale': '*',
    }).then((assets) => {
      let wrapped = {};
      assets.items.forEach((asset) => {
        const field = asset.fields.file[this.lang];
        wrapped[asset.sys.id] = embed(field, this.wrapperConfig);
      });
      return wrapped;
    });
  }

  /**
   * Retrieve a single entry by it's UUID. If the entry is  missing from cache,
   * an API request will be made to fetch from Contentful.
   * @param {String} entryId - Contentful UUID.
   * @return {Promise} - Resolved with the entry object.
   */
  entry(entryId) {
    return this.cache.wrap(entryId, () => {
      return this.syncOne(entryId);
    });
  }

  // Caching
  // --

  /**
   * Override this in your implementation if you need to perform logic in your
   * application once a record cache has been created or updated. Otherwise,
   * just use `cache.get` to retrieve entries from cache or API.
   */
  onCacheUpdate() {}

  /**
   * Update the internal cache with an entry returned from the API.
   * @param {Object} entry - A raw Contentful entry from the API.
   * @return {Object} - The wrapped entry.
   */
  cacheUpdate(entry) {
    this.cache.set(entry.sys.id, entry);
    this.onCacheUpdate(entry);
    return entry;
  }

  /**
   * Override this in your implementation if you need to perform logic in your
   * application once a record has been removed from cache. This will not be
   * called when a record has expired or if you use `cache.del` manually.
   */
  onCacheDestroy() {}

  /**
   * Remove an entry from cache including it's route. This is typically used
   * to unpublish an entry in production but can be triggered manually also.
   * @param {Object} entryId - ID of the Contentful entry.
   */
  cacheDestroy(entryId) {
    this.cache.del(entryId);
    this.onCacheDestroy(entryId);
    this.deleteRoute(entryId);
  }

  // Routing
  // --

  /**
   * Get all routes that have been registered for content.
   * @return {Promise} Fulfilled with the cache contents.
   */
  getRoutes() {
    return this.cache.get('$routes');
  }

  /**
   * Update internal routing cache with new content.
   * @param {Object} routes - New routes to be merged.
   * @return {Promise}
   */
  async updateRoutes(routes) {
    let existing = await this.getRoutes();
    return this.cache.set('$routes', {
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
    let routes = await this.getRoutes();
    const key = _.findKey(routes, (val) => val[1] === entryId);
    if (!key) return;
    delete routes[key];
    this.cache.set('$routes', routes);
  }

  // Sync
  // --

  /**
   * Helper function to run a full sync against Contentful. All content will be
   * pulled down with paginated API requests and cached.
   * @return {Promise} - Fulfilled when the sync has finished.
   */
  sync() {
    return this.syncPaged();
  }

  /**
   * .syncOne
   * --
   * Returns a structure functionally similar to `syncPaged` but without the
   * overhead of going through every single entry. This is used to update a
   * single entry in cache if it has expired or is not found.
   * @param {String} entryId - Contentful UUID for the entry.
   * @return {Promise} - Fullfilled with the wrapped Contentful entry.
   */
  syncOne(entryId) {
    return this.client().getEntries({
      'sys.id': entryId,
      'locale': '*',
      'include': 10,
    }).then((entry) => {
      entry = entry.toPlainObject();

      if (!entry.items[0]) return;
      return this.cacheUpdate(entry.items[0]);
    });
  }

  /**
   * The `sync` function provided by Contentful does not work under Preview
   * mode. This replaces the built-in convenience function with our own which
   * will work consistently between development and production.
   * @param {Number} limit How many entries to include. Defaults to 250.
   * @param {Number} skip How many entries to skip; will be auto-incremented.
   * @return {Promise} - Fullfilled once all pages have been sync'd.
   */
  syncPaged(limit, skip) {
    return this.client().getEntries({
      locale: '*',
      include: 10,
      limit: limit || 250,
      order: '-sys.updatedAt',
      skip: skip || 0,
    }).then((response) => {
      response = response.toPlainObject();

      const routes = response.items
          .filter(({fields}) => !!fields.slug)
          .reduce((all, {fields, sys}) => {
            all[fields.slug[this.lang]] = [sys.contentType.sys.id, sys.id];
            return all;
          }, {});

      this.updateRoutes(routes);

      // Each entry is wrapped and cached.
      _.each(response.items, async (entry) => {
        await this.cacheUpdate(entry);
      });

      // When the number of entries exceeds what we have downloaded thus far,
      // the function calls itself with the same limit and an auto-incremented
      // value for `skip`.
      if (response.total > response.skip + response.limit) {
        return this.syncPaged(limit, response.skip + response.limit);
      }

      return response;
    });
  }

  /**
   * Wrap a single entry in the Contentful entity wrapper.
   * @param {Object} entry - The entry to wrap.
   * @return {Object} - The wrapped entity.
   */
  wrap(entry) {
    return new ContentfulWrapper(entry, this.wrapperConfig);
  }
}

module.exports = ContentfulCache;
