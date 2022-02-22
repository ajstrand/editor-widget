#!/usr/bin/env node
import pkg from "neo-blessed"
const { Screen }= pkg;
//var Editor = require('../.');

import myThing from "./index.js";
console.log(myThing)
var screen = new Screen();
screen.key('C-q', function () { process.exit(); });
var editor = new myThing({parent: screen});
editor.open(__filename).done();
