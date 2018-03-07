const _ = require('lodash');
const querystring = require('querystring');

/**
 * Converts image fields into a function to construct the URL. Can either pass
 * a width and a height separately as parameters or pass a single object with
 * options: https://www.contentful.com/developers/docs/references/images-api
 * @param {String} imageUrl The URL of the image field.
 * @param {Object} config - Optional configuration to include in output. If you
 * are using a third party image processor such as IMGIX you can include
 * additional parameters here.
 * @return {Function} A function which can be used in the template.
 */
function embedImage(imageUrl, config) {
  // Customize the default embed parameters with the `embedParams` key passed
  // to the constructor. If you are using a third party image processor such
  // as IMGIX you can include additional parameters here.
  const customParams = config.embedParams;

  // Replace the `images.contentful.com` hostname with your own CDN. Your CDN
  // should point it's root folder to your Contentful space ID for rewriting.
  if (config.cdnHost) {
    let hostAddress = `images.ctfassets.net/${config.spaceId}`;
    imageUrl = imageUrl.replace(hostAddress, config.cdnHost);
  }

  return function(width, height) {
    let params = typeof width === 'object' ? width :
          _.merge({w: width, h: height}, customParams || {});
    return `${imageUrl}?${querystring.stringify(params)}`;
  };
}

/**
 * Wraps a file field with a function to access the file link directly.
 * Currently only image fields are decorated and all other files will simply
 * return the URL of the associated file.
 * @param {Object} file - The file field to wrap.
 * @param {Object} config - Optional configuration to include in output.
 * @return {String|Function} - The URL to the file or a decorator function.
 */
module.exports = function embedAsset(file, config) {
  const urlOrFunc = (contentType, url, config) => {
    switch (contentType) {
    case 'image/jpeg':
    case 'image/png':
      return embedImage(url, config);
    default:
      return url;
    }
  };

  if (!file.length)
    return urlOrFunc(file.contentType, file.url, config);

  return file.map((embed) => {
    const file = embed.fields.file[config.lang || 'en-US'];
    return urlOrFunc(file.contentType, file.url, config);
  });
};
