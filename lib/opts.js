var path = require('path');
var rc = require('rc');
var util = require('slap-util');

var pk = require('../package');
var configFile = path.resolve(__dirname, '..', pk.name + '.ini');
module.exports = util.parseOpts(rc(pk.name, configFile));
