module.exports = function transformAssets(field, config) {
  // This transformation will only run on file type fields.
  if (!(field.fields && field.fields.file) &&
    !(Array.isArray(field) && field[0].fields.file)) return field;

  // Always include the title and description even if Contentful does not hold
  // values for these fields. Replace the `images.contentful.com` hostname with
  // your own CDN. Your CDN should to the root folder of your Contentful space.
  const assetMeta = (fields) => {
    const lang = config.lang || 'en-US';
    const {title, description, file} = fields;
    const {details, contentType, url} = file[lang];

    return {
      title: title[lang],
      description: description && description[lang] || '',
      url: ((url) => {
        if (!config.cdnHost) return url;
        let hostAddress = `images.ctfassets.net/${config.spaceId}`;
        return url.replace(hostAddress, config.cdnHost);
      })(url),
      file: {
        contentType,
        ...details,
      },
    };
  };

  if (!field.length) return assetMeta(field.fields);
  return field.map(({fields}) => assetMeta(fields));
};
