module.exports = (field, config) => [
  'assets',
  'pretty',
].reduce((result, cmd) => require(`./${cmd}`)(result, config), field);
