module.exports = function transformPretty(field, config) {
  if (typeof field.replace !== 'function') return field;

  field = field.replace(/(?:\r\n|\r|\n)/g, '<br />');

  // The markdown processor already takes care of smart character
  // conversion. But for other fields, such as title, we still perform a
  // subset of this conversion for display purposes.
  if (config.fieldName !== 'body' && !config.forceHtml) {
    field = field.replace(/---/g, '\u2014') // em-dashes
        .replace(/--/g, '\u2013') // en-dashes
        .replace(/(^|[-\u2014/(\[{"\s])'/g, '$1\u2018') // single quotes
        .replace(/'/g, '\u2019') // closing singles & apostrophes
        .replace(/(^|[-\u2014/(\[{\u2018\s])"/g, '$1\u201c') // double quotes
        .replace(/"/g, '\u201d'); // closing doubles
  }

  return field;
};
