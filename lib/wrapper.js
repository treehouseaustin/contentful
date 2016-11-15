const _ = require('lodash');
const markdown = require('marked');
const moment = require('moment');
const striptags = require('striptags');

const embed = require('./embed-asset.js');

/**
 * Wraps each Contentful entry with a set of convenience functions and
 * properties. The most noticeable of this is `get` which processes the
 * field by converting to HTML or converting to a media function.
 */
class ContentfulWrapper {

  /**
   * Wrap a Contentful entity object with this class.
   * @param {Object} content - Contentful entity.
   * @param {Object} config - Optional configuration. If you want to customize
   * the Markdown parser settings you can do so here by setting the `markdown`
   * property on this object.
   */
  constructor(content, config = {}) {
    // Configuration options include setting the default language and Markdown
    // parser settings. Both are optional and no configuration is required.
    this.lang = config.lang || 'en-US';
    this.config = config;
    markdown.setOptions(config.markdown);

    // The entire entity returned by Contentful is accessible at `.__raw`.
    this.__raw = content;

    // @TODO: These convenience accessors should be disabled in the future.
    this.fields = content.fields;
    this.sys = content.sys;

    // Each field is aliased by it's machine ID in Contentful. It is, however,
    // recommended that all fields are accessed through the `.get` function.
    // Optional fields in Contentful that are blank for a particular entity will
    // be undefined and accessing by the property name could throw errors.
    _.each(Object.keys(this.fields), (fieldName) => {
      this[fieldName] = this.fieldToHtml(fieldName);
    });

    this.slug = this.getSlug();
  }

  /**
   * Return render-ready HTML markup for the field being requested. This will
   * run the field through a Markdown parser and perform file field decorations.
   * @param {String} fieldName - The name of the field to return.
   * @param {Boolean} forceHtml - If this is set to `false` (the default) only
   * the `body` field will be run through the Markdown parser. You can force the
   * Markdown conversion by passing `true` here.
   * @param {Object} mdParser - Use an alternate Markdown parser.
   * @return {String|Function} - The render-ready field or a decorator function.
   */
  fieldToHtml(fieldName, forceHtml = false, mdParser = markdown) {
    let field = this.getPlain(fieldName);
    if (!field) return '';

    if (fieldName === 'body' || forceHtml) {
      field = mdParser(field).replace(/(?:\r\n|\r|\n)/g, '');
    }

    if (field && typeof field.replace === 'function') {
      field = field.replace(/(?:\r\n|\r|\n)/g, '<br />');

      // The markdown processor already takes care of smart character
      // conversion. But for other fields, such as title, we still perform a
      // subset of this conversion for display purposes.
      if (fieldName !== 'body' && !forceHtml) {
        field = field.replace(/---/g, '\u2014') // em-dashes
          .replace(/--/g, '\u2013') // en-dashes
          .replace(/(^|[-\u2014/(\[{"\s])'/g, '$1\u2018') // single quotes
          .replace(/'/g, '\u2019') // closing singles & apostrophes
          .replace(/(^|[-\u2014/(\[{\u2018\s])"/g, '$1\u201c') // double quotes
          .replace(/"/g, '\u201d'); // closing doubles
      }
    }

    // Any file field references will decorate the value with a helper function
    // to request specific cropping or other image modifications from the CDN.
    if (_.has(field.length ? field[0] : field, `fields.file["${this.lang}"]`)) {
      field = embed(field.length ? field : field.fields.file[this.lang], this.config);
    }

    if (_.get(field, 'sys.type') === 'Link') {
      field = null;
    }

    return field;
  }

  /**
   * Getter for any field on the entity. It is recommended to use this rather
   * than trying to access the object directly. This method has sufficient logic
   * to prevent exceptions from being thrown when optional fields are blank. In
   * addition, by passing arguments to this function, you can customize the
   * returned results without having to worry about the property being defined.
   * @param {String} fieldName - The name of the field or the path to a nested
   * object property to return.
   * @param {*} args - Any number of arguments will be passed to the field.
   * @return {String|Object} - The field value or a blank string.
   */
  get(fieldName, ...args) {
    let content = this.fieldToHtml(fieldName);
    if (typeof content === 'function') {
      return content.apply(this, args);
    }
    return content;
  }

  /**
   * Use the `moment` library to return a formatted date.
   * @param {String} format - A format string passed to moment.
   * @param {String} fieldName - Defaults to `date`.
   * @return {String} - The formatted date.
   */
  getDate(format, fieldName = 'date') {
    return moment(this.getPlain(fieldName)).format(format);
  }

  /**
   * Get the HTML markup for the field being requestedusing  a Markdown parser.
   * @param {String} fieldName - The name of the field to return.
   * @param {Object} mdParser - Use an alternate Markdown parser.
   * @return {String} - An HTML string with the field value.
   */
  getHtml(fieldName, mdParser = markdown) {
    return this.fieldToHtml(fieldName, true, mdParser);
  }

  /**
   * Get an absolute link to the entry which can be used in an `<a href` tag.
   * @return {String} - An absolute link.
   */
  getLink() {
    return `/${this.slug}/`.replace(/\/{2,}/g, '/');
  }

  /**
   * Get the raw value of the field as it exists on the entry in Contentful.
   * This function can also be used to deep fetch properties. The entire fetch
   * block is contained in a try/catch block to ensure that if the field or
   * deep relation is not defined, the template doesn't throw an exception.
   * @param {String|Array} fields - The name of the field or the path to a
   * nested object property to return. The final `['en-US']` accessor is added
   * automatically but for nested paths the shortcut `.LANG` can be used to
   * substitute the currently selected language.
   * @return {String|Object} - The field value or a blank string.
   */
  getPlain(fields) {
    if (typeof fields === 'string') fields = [fields];
    fields = fields.map((field) => field.replace('.LANG', `['${this.lang}']`));
    try {
      // Allow for deeply nested lookups without complex ternaries.
      let field = new Function('_', `return ${
        fields.map((field) => `_.${field}`).join(' || ')
      }`)(this.fields);
      // Alias the field as the primary language if applicable.
      if (typeof field === 'object' && typeof field[this.lang] !== 'undefined')
        field = field[this.lang];
      return field || '';
    } catch(err) {
      console.error(err);
      return '';
    }
  }

  /**
   * Get the entry slug based on the `urlMapping` configuration. Each content
   * type can be configured with a prefix which is used to determine the slug.
   * @return {String} - An absolute link.
   */
  getSlug() {
    const slug = this.fields.slug && this.fields.slug[this.lang];
    if (!slug) return;

    const type = _.get(this.sys, 'contentType.sys.id');
    return [this.config.urlMapping[type] || type, slug].join('/');
  }

  /**
   * Get a snippet representing the entity. By default this uses the `body`
   * field and can be useful when previewing content for example on a Blog. All
   * HTML tags are stripped from the field before it is trimmed to length.
   * @param {Number} length - Final snippet length not including ellipses.
   * @param {String} fieldName - The field to trim and return.
   * @return {String} - Trimmed field stripped of HTML.
   */
  getSnippet(length = 250, fieldName = 'body') {
    if (!this.fields[fieldName]) return '';
    const parsed = this.fieldToHtml(fieldName).replace(/<(p|br) ?\/?>/g, ' ');
    return striptags(parsed.trim()).substr(0, length).trim().concat('...');
  }

}

module.exports = ContentfulWrapper;
