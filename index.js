import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Editor = require("./lib/Editor")
console.log(Editor)
export default Editor
