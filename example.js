#!/usr/bin/env node
import pkg from "neo-blessed"
const { Screen }= pkg;
//var Editor = require('../.');

import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);

//const x = fileURLToPath("./hello.md")

import Editor from "./lib/Editor.js";
var screen = new Screen();
screen.key('C-q', function () { process.exit(); });
var editor = new Editor({parent: screen});
editor.open(__filename).done();