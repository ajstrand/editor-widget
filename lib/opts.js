import { resolve } from 'path';
import rc from 'rc';
import { parseOpts } from 'slap-util';

import { name } from '../package';
var configFile = resolve(__dirname, '..', name + '.ini');
export default parseOpts(rc(name, configFile));
