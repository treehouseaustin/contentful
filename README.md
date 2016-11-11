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

Routing
--

As content is sync'd a routing map is built based on the slug in Contentful that
can be used in your application to serve the page contents. By default, the slug
is determined based on the machine ID of the entry in Contentful. In many cases
this may be sufficient, but if you inherit an existing content model or use any
of the default content types you may want to override this. To do so, pass a
keyed object to `config.wrapper.urlMapping` where the key is the machine ID of
the content type in Contentful and the value is the path to use in routing:

```
const ContentAPI = new Contentful('SPACEID', {
  ...
  wrapper: {
    urlMapping: {
      blogPosts: 'blog'
    }
  }
});
```

This configuration will map the `blogPosts` content type in Contentful to the
route `/blog`. An entry with the slug `my-awesome-blog-post` will have a final
route of `/blog/my-awesome-blog-post`

The final cached routing map is a keyed object where the key represents the
final resolved path. The value is an array with two values that can be used for
lookup of the content entity from cache: the first value corresponding to the
machine ID of the content type and the second value corresponding to the ID of
the content. So the example above would produce the following routing map:

```
routes: {
  '/blog/my-awesome-blog-post': ['blogPosts', '3iJsN1jc5qQGa8cwmesQQq']
}
```

When content is removed from cache the route is removed as well.
