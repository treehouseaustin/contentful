/**
 * Wraps a file field with a function to access the file link directly.
 * Currently only image fields are decorated and all other files will simply
 * return the URL of the associated file.
 * @param {Object} file - The file field to wrap.
 * @param {Object} config - Optional configuration to include in output.
 * @return {String|Function} - The URL to the file or a decorator function.
 */
module.exports = function embedAsset(file, config) {
  // Replace the `images.contentful.com` hostname with your own CDN. Your CDN
  // should point it's root folder to your Contentful space ID for rewriting.
  const cdnUrl = (url) => {
    if (!config.cdnHost) return url;
    let hostAddress = `images.ctfassets.net/${config.spaceId}`;
    return url.replace(hostAddress, config.cdnHost);
  };

  if (!file.length) return cdnUrl(file.url);

  return file.map((embed) => {
    const file = embed.fields.file[config.lang || 'en-US'];
    return cdnUrl(file.url);
  });
};
