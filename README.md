Contentful wrapper
==

Caching and entity wrapper to sync content from a Contentful space and integrate
in your web application. The purpose of this module is to provide a layer of
abstraction between your site and the Contentful API for the most common use
case: rendering your content from the server.

Getting started
--

By default, the Contentful wrapper uses
[cache-manager](https://www.npmjs.com/package/cache-manager) to cache
everything in memory. It is highly recommended in Production to use Redis or
some other cache backend external to your web dyno which will allow you to scale
horizontally in response to traffic.

The environment that you run your application in will determine the Contentful
API that is used. In `production` the standard API is used to return only
published content. Otherwise, the Preview API is used which includes both
published and unpublished content. By default, `process.env.NODE_ENV` is used to
determine the environment; you can also override in the configuration.

**Basic setup**

```
const Contentful = require('@treehouse/contentful');
const ContentAPI = new Contentful('SPACEID', {
  accessToken: 'PRODUCTION_ACCESS_TOKEN',
  previewToken: 'PREVIEW_API_TOKEN'
});

ContentAPI.syncPaged().then(() => {
  // Content sync complete!
});
```

**Wrapper configuration**

All entries are wrapped in a convenience class that performs markdown parsing,
determines slug URLs, and even wraps image URLs in a decorator function.
Configuration can be controlled with the `wrapper` key during initialization:

```
const ContentAPI = new Contentful('SPACEID', {
  accessToken: 'PRODUCTION_ACCESS_TOKEN',
  previewToken: 'PREVIEW_API_TOKEN',
  wrapper: {
    lang: 'en-US',
    urlMapping: {
      blogPosts: 'blog'
    }
  }
});
```

Detailed documentation on the available methods and configuration options for
the wrapper class [can be found here](./lib/WRAPPER.md).
