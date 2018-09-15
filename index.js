const {createClient} = require('contentful');

const ContentfulWrapper = require('./lib/wrapper');
const CacheService = require('./lib/cache');
const embed = require('./lib/embed-asset');

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
    this.cache = new CacheService(config.cache);

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
   * Repeated calls to `.client` after the Contentful client has been created
   * will return a cached instance.
   * @return {Object} - Contentful API client.
   */
  get client() {
    if (this.connect) return this.connect;

    // When running in `development` mode, the Contentful API client will
    // automatically switch over to Preview mode. This displays both published
    // and unpublished content. It is important that the access token be set
    // properly (Preview vs. Production) based on the environment.
    const accessToken = this.isProd ? this.accessToken : this.previewToken;
    const host = !this.isProd ? 'preview.contentful.com' : null;

    this.connect = createClient({
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
      return this.client.getAsset(assetId);
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
    return this.client.getAssets({
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
   * @return {Promise} - Resolved with the wrapped entry object.
   */
  async entry(entryId) {
    let entry = await this.cache.entry(entryId);
    if (!entry) {
      entry = await this.syncOne(entryId);
    }
    return this.wrap(entry);
  }

  // Sync
  // --

  /**
   * Helper function to run a full sync against Contentful. All content will be
   * pulled down with paginated API requests and cached.
   * @return {Promise} - Fulfilled when the sync has finished.
   */
  async sync() {
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
    return this.client.getEntries({
      'sys.id': entryId,
      'locale': '*',
      'include': 10,
    }).then((entry) => {
      entry = entry.toPlainObject();

      if (!entry.items[0]) return;
      return this.cache.update(entry.items[0]);
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
    return this.client.getEntries({
      locale: '*',
      include: 10,
      limit: limit || 250,
      order: '-sys.updatedAt',
      skip: skip || 0,
    }).then((response) => {
      response = response.toPlainObject();
      this.cache.updateEntries(response.items);

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
