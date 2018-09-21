const Contentful = require('../');

module.exports = (sails) => {
  sails.registerAction(async function refresh(req, res) {
    await sails.hooks.contentful.api.sync();
    res.status(200).send('ok');
  }, 'contentful/refresh');

  sails.registerAction(function webhook(req, res) {
    // If request does not include webhook token, do not proccess it
    const key = req.header('X-Contentful-Webhook-Key');
    if (!key || key !== sails.config.contentful.webhookToken) {
      sails.log.warn('update request without webhook token');
      return res.status(403).send('invalid token');
    }

    sails.log.verbose(`update requested ${req.header('X-Contentful-Topic')}`);

    // Determine what type of update this is
    switch (req.header('X-Contentful-Topic')) {
      // `ContentManagement.Entry.auto_save` indicates that an Entry was saved.
      // This action is only respected in the `development` environment because
      // it will be triggered on newly created but unpublished content.
      case 'ContentManagement.Entry.auto_save':
        if (sails.config.contentful.env !== 'development') break;
        sails.hooks.contentful.api.cache.update(req.body);
        break;

      // `ContentManagement.Entry.publish` indicates an Entry was published.
      // This may represent a brand new Entry or an update to an existing one.
      case 'ContentManagement.Entry.publish':
        sails.hooks.contentful.api.cache.update(req.body);
        break;

      // `ContentManagement.Entry.delete` or `ContentManagement.Entry.unpublish`
      // indicates an Entry should no longer be visible to end-users. If the
      // content was not deleted, it can be re-published and will re-appear.
      case 'ContentManagement.Entry.delete':
        sails.hooks.contentful.api.cache.destroy(req.body.sys.id);
        break;

      // On `development`, the unpublish action has no effect. This allows an
      // entry to be removed from the live site but still accessible privately.
      case 'ContentManagement.Entry.unpublish':
        if (sails.config.contentful.env !== 'development') break;
        sails.hooks.contentful.api.cache.destroy(req.body.sys.id);
        break;

      // Only a subset of functionality is implemented at this time.
      default:
        sails.log.error(`${req.header('X-Contentful-Topic')} not implemented.`);
    }

    res.status(200).send('ok');
  }, 'contentful/webhook');

  return {

    api: new Contentful(sails.config.contentful.space, sails.config.contentful),

    async initialize(cb) {
      if (!sails.config.contentful) {
        sails.log.warn('No access token was found for Contentful.');
        return cb();
      }

      sails.log.verbose('contentful sync started');
      await this.api.sync();

      await this.api.cache.routes();
      sails.log.verbose('contentful sync complete');

      cb();
    },

    async entry(id) {
      try {
        // Some of the internal or system cached fields are not necessary.
        // @TODO: Incorporate this capability to the core library.
        const {__raw, config, fields, sys, ...entry} = await this.api.entry(id);
        sails.log.silly(__raw, config, fields);
        entry.id = sys.id;
        return entry;
      } catch (err) {
        sails.log.error(err);
        return false;
      }
    },

  };
};
