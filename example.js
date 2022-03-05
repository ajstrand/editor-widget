#!/usr/bin/env node
import {fileURLToPath} from 'url';
import pkg from "neo-blessed";
import Editor from "./lib/Editor.js";

const { Screen } = pkg;

const __filename = fileURLToPath(import.meta.url);

var screen = new Screen();
screen.key('C-q', function () { process.exit(); });
var editor = new Editor({parent: screen});
//editor.open(__filename).done();
editor.open("./example.js").done()