import _ from "lodash"
//import Promise from 'bluebird';
import pkg from "bluebird"
const { Promise } = pkg

import fs from "fs"
const fsp = Promise.promisifyAll(fs)
import { extname } from "path"
// import lodash from "lodash"
//import 'es6-set/implement'; // required for text-buffer
//if (require('semver').lt(process.version, '4.0.0')) require('iconv-lite').extendNodeEncodings(); // FIXME: destroy this abomination
import TextBuffer from "text-buffer"
import Point from "text-buffer/lib/point.js"
import Range from "text-buffer/lib/range.js"
import copyPaste from "copy-paste"
const clipboard = Promise.promisifyAll(copyPaste)

import util from "slap-util"
import { prev, next, current, wordEnd } from "./word.js"
import optsResult from "./opts.js"
import spawn from "./highlight/client.js"
import BaseWidget from "base-widget"
import padStart from "lodash.padstart"
import Field from "./Field.js"

class Editor extends BaseWidget {
  constructor(opts) {
    super(opts)
    const self = this

    if (!(self instanceof Editor)) return new Editor(opts)

    const defaultOpts = optsResult.editor

    if (defaultOpts === undefined) {
      console.error("config.ini was never copied over")
      return
    }

    //TODO:seems kind of hacky, but this replaces BaseWidget.call
    self.options = {
      ...self,
      ..._.merge(
        {
          focusable: true,
          multiLine: true,
        },
        defaultOpts,
        opts
      ),
    }

    // BaseWidget.call(
    //   self,
    //   _.merge(
    //     {
    //       focusable: true,
    //       multiLine: true,
    //     },
    //     defaultOpts,
    //     opts
    //   )
    // )

    self.gutter = new BaseWidget(
      _.merge(
        {
          parent: self,
          tags: true,
          wrap: false,
          style: {},
          top: 0,
          left: 0,
          bottom: 0,
        },
        self.options.gutter
      )
    )

    self.buffer = new BaseWidget(
      _.merge(
        {
          parent: self,
          tags: true,
          wrap: false,
          style: {},
          top: 0,
          left:
            self.options.multiLine && !self.gutter.options.hidden
              ? self.gutter.width
              : 0,
          right: 0,
          bottom: 0,
        },
        self.options.buffer
      )
    )

    self.textBuf = new TextBuffer({
      encoding: self.options.defaultEncoding,
      text: self.options.text,
    })

    if (!self.options.text) {
      self.textBuf.loadSync()
    }

    self.selection = self.textBuf.markPosition(new Point(0, 0), {
      type: "selection",
      invalidate: "never",
    })
    self.scroll = new Point(0, 0)
    self.data.updatePreferredX = true

    self.language(false)
    self.toggleInsertMode()
    self._initHighlighting()

    const _updateContent = self._updateContent.bind(self)
    self._updateContent = _.throttle(
      _updateContent,
      //FIXME: this is a hack since self.options.pref
      // is not defined somehow
      defaultOpts.perf.updateContentThrottle,
      //self.options.perf.updateContentThrottle,
      false
    )
    self._updateContent()
  }
  // open(givenPath) {
  //   //   // Handles nonexistent paths
  //   var self = this;
  //   //console.log(givenPath);
  //   return self.ready // ensures textBuf path-changed is triggered in _initHandlers
  //     .then(function () { return Editor.getOpenParams(givenPath); })
  //     .tap(function (params) { return self.textBuf.setPath(params.path); })
  //     .tap(function (params) {
  //       if (params.exists)
  //         return self.textBuf.load();
  //     })
  //     .tap(function (params) { self.selection.setHeadPosition(params.position); })
  //     .return(self);
  // }
  toggleInsertMode() {
    return this.insertMode(!this.insertMode())
  }
  lineWithEndingForRow(row) {
    const self = this
    return self.textBuf.lineForRow(row) + self.textBuf.lineEndingForRow(row)
  }
  delete(range) {
    const self = this
    self.textBuf.delete(range || self.selection.getRange())
    return self
  }
  _getTabString() {
    const self = this
    return self.buffer.options.useSpaces
      ? _.repeat(" ", self.buffer.options.tabSize)
      : "\t"
  }
  indent(range, dedent) {
    const self = this

    const tabString = self._getTabString()
    const indentRegex = new RegExp(
      `^(\t| {0,${self.buffer.options.tabSize}})`,
      "g"
    )
    let startDiff = 0,
      endDiff = 0
    const linesRange = range.copy()
    linesRange.start.column = 0
    linesRange.end.column = Infinity
    self.textBuf.setTextInRange(
      linesRange,
      util.text
        .splitLines(self.textBuf.getTextInRange(linesRange))
        .map((line, i) => {
          const result = !dedent
            ? tabString + line
            : line.replace(indentRegex, "")
          if (i === 0) startDiff = result.length - line.length
          if (i === range.getRowCount() - 1)
            endDiff = result.length - line.length
          return result
        })
        .join("")
    )
    range = range.copy()
    range.start.column += startDiff
    range.end.column += endDiff
    self.selection.setRange(range)
    return self
  }
  visiblePos(pos) {
    const self = this
    if (pos instanceof Range)
      return new Range(self.visiblePos(pos.start), self.visiblePos(pos.end))
    pos = Point.fromObject(pos, true)
    pos.column = self
      .lineWithEndingForRow(pos.row)
      .slice(0, Math.max(pos.column, 0))
      .replace(
        Editor._tabRegExp,
        _.repeat("\t", self.buffer.options.tabSize)
      ).length
    return pos
  }
  realPos(pos) {
    const self = this
    if (pos instanceof Range)
      return new Range(self.realPos(pos.start), self.realPos(pos.end))
    pos = Point.fromObject(pos, true)
    pos.column = this.lineWithEndingForRow(self.textBuf.clipPosition(pos).row)
      .replace(Editor._tabRegExp, _.repeat("\t", this.buffer.options.tabSize))
      .slice(0, Math.max(pos.column, 0))
      .replace(
        new RegExp(`\\t{1,${this.buffer.options.tabSize}}`, "g"),
        "\t"
      ).length
    return self.textBuf.clipPosition(pos)
  }
  moveCursorVertical(count, paragraphs) {
    const self = this
    const { selection } = self
    const cursor = selection.getHeadPosition().copy()
    if (count < 0 && cursor.row === 0) {
      selection.setHeadPosition(new Point(0, 0))
    } else if (count > 0 && cursor.row === self.textBuf.getLastRow()) {
      selection.setHeadPosition(new Point(Infinity, Infinity))
    } else {
      if (paragraphs) {
        paragraphs = Math.abs(count)
        const direction = count ? paragraphs / count : 0
        while (paragraphs--) {
          while (true) {
            cursor.row += direction

            if (!(0 <= cursor.row && cursor.row < self.textBuf.getLastRow()))
              break
            if (/^\s*$/g.test(self.textBuf.lineForRow(cursor.row))) break
          }
        }
      } else {
        cursor.row += count
      }

      const x = self.data.preferredCursorX
      if (typeof x !== "undefined")
        cursor.column = self.realPos(new Point(cursor.row, x)).column
      self.data.updatePreferredX = false
      selection.setHeadPosition(cursor)
      self.data.updatePreferredX = true
    }

    return self
  }
  moveCursorHorizontal(count, words) {
    const self = this
    const { selection } = self

    if (words) {
      words = Math.abs(count)
      const direction = words / count
      while (words--) {
        var cursor = selection.getHeadPosition()
        const line = self.textBuf.lineForRow(cursor.row)
        const wordMatch = word[direction === -1 ? "prev" : "current"](
          line,
          cursor.column
        )
        self.moveCursorHorizontal(
          direction *
            Math.max(
              1,
              {
                "-1": cursor.column - (wordMatch ? wordMatch.index : 0),
                1:
                  (wordMatch
                    ? wordMatch.index + wordMatch[0].length
                    : line.length) - cursor.column,
              }[direction]
            )
        )
      }
    } else {
      var cursor = selection.getHeadPosition().copy()
      while (true) {
        if (-count > cursor.column) {
          // Up a line
          count += cursor.column + 1
          if (cursor.row > 0) {
            cursor.row -= 1
            cursor.column = self.textBuf.lineForRow(cursor.row).length
          }
        } else {
          const restOfLineLength =
            self.textBuf.lineForRow(cursor.row).length - cursor.column
          if (count > restOfLineLength) {
            // Down a line
            count -= restOfLineLength + 1
            if (cursor.row < self.textBuf.getLastRow()) {
              cursor.column = 0
              cursor.row += 1
            }
          } else {
            // Same line
            cursor.column += count
            selection.setHeadPosition(cursor)
            break
          }
        }
      }
    }

    return self
  }
  matchingBracket(pos) {
    const self = this

    pos = pos || self.selection.getHeadPosition()
    const bracket = (
      self.lineWithEndingForRow(pos.row)[pos.column] || ""
    ).match(Editor._bracketsRegExp)
    if (!bracket) return
    const start = !!bracket[1]
    const _half = (bracket.length - 3) / 2 + 1
    function oppositeBracketMatchIndex(bracketMatch) {
      let matchIndex
      bracketMatch.some((match, i) => {
        if ([0, 1, _half + 1].indexOf(i) === -1 && match) {
          matchIndex = i + _half * (start ? 1 : -1)
          return true
        }
      })
      return matchIndex
    }

    const lines = util.text.splitLines(
      self.textBuf.getTextInRange(
        start
          ? new Range(pos, new Point(Infinity, Infinity))
          : new Range(new Point(0, 0), new Point(pos.row, pos.column + 1))
      )
    )

    if (!start) lines.reverse()

    const matches = []
    let result = false
    lines.some((line, row) => {
      let column = start ? -1 : Infinity
      while (true) {
        column = start
          ? util.text.regExpIndexOf(line, Editor._bracketsRegExp, column + 1)
          : util.text.regExpLastIndexOf(
              line.slice(0, column),
              Editor._bracketsRegExp
            )
        if (column === -1) break
        const match = line[column].match(Editor._bracketsRegExp)
        if (!!match[1] === start) {
          matches.push(match)
        } else {
          const isOppositeBracket =
            !!match[oppositeBracketMatchIndex(matches.pop())]
          if (!matches.length || !isOppositeBracket) {
            result = {
              column: column + (start && row === 0 && pos.column),
              row: pos.row + (start ? row : -row),
              match: isOppositeBracket,
            }
            return true
          }
        }
      }
    })
    return result
  }
  _requestHighlight() {
    const self = this
    if (self.options.highlight) {
      const { highlight } = self.data
      highlight.revision++
      Editor.highlightClient
        .call("send", {
          type: "highlight",
          text: self.textBuf.getText(),
          language: self.language(),
          revision: highlight.revision,
          bucket: highlight.bucket,
        })
        .done()
    }
  }
  _initHighlighting() {
    const self = this

    self.data.highlight = {
      ranges: [],
      revision: 0,
      bucket: spawn.getBucket(),
    }

    if (!Editor.count++)
      Editor.highlightClient = spawn().tap((client) => {
        const loggerOpts = self.options.logger
        if (loggerOpts) client.send({ type: "logger", options: loggerOpts })
      })
    self.on("detach", () => {
      if (--Editor.count) return
      Editor.highlightClient
        .tap((client) => {
          if (!client) return
          client.dontRespawn = true
          client.kill()
        })
        .done()
      self._updateCursor()
    })

    Editor.highlightClient.done((client) => {
      self.on("language", () => {
        self._requestHighlight()
      })
      self.textBuf.onDidChange(() => {
        self._requestHighlight()
      })
      client.once("message", function highlight(data) {
        if (self.isAttached()) client.once("message", highlight)
        if (
          data.bucket === self.data.highlight.bucket &&
          data.revision >= self.data.highlight.revision
        ) {
          self.destroyMarkers({ type: "syntax" })
          self.data.highlight = data
          self.data.highlight.ranges.forEach((range) => {
            self.textBuf.markRange(range.range, range.properties)
          })
          self._updateContent()
        }
      })
    })

    return self
  }
  clipScroll(poss) {
    const self = this

    const size = self.buffer.size()
    const scroll = (poss || []).reduce((scroll, pos) => {
      const cursorPadding = self.buffer.options.cursorPadding || {}
      const minScroll = pos
        .translate(size.negate())
        .translate(
          new Point(
            (cursorPadding.right || 0) + 1,
            (cursorPadding.bottom || 0) + 1
          )
        )
      const maxScroll = pos.translate(
        new Point(-cursorPadding.left || 0, -cursorPadding.top || 0)
      )

      return new Point(
        Math.min(Math.max(scroll.row, minScroll.row), maxScroll.row),
        Math.min(Math.max(scroll.column, minScroll.column), maxScroll.column)
      )
    }, self.scroll)

    self.scroll = new Point(
      Math.max(0, Math.min(scroll.row, self.textBuf.getLineCount() - size.row)),
      Math.max(0, scroll.column)
    )
    self._updateContent()

    return self
  }
  _markMatches() {
    const self = this
    const selection = self.selection.getRange()
    const selectionText = self.textBuf.getTextInRange(selection)
    const line = self.lineWithEndingForRow(selection.end.row)

    self.destroyMarkers({ type: "match" })
    if (
      selection.isSingleLine() &&
      selectionText.match(/^[\w.-]+$/) &&
      (line[selection.start.column - 1] || " ").match(/\W/) &&
      (line[selection.end.column] || " ").match(/\W/)
    ) {
      self.textBuf.scan(
        new RegExp(`\\b${_.escapeRegExp(selectionText)}\\b`, "g"),
        (match) => {
          self.textBuf.markRange(match.range, { type: "match" })
        }
      )
    }
    return self
  }
  _initHandlers() {
    const self = this

    const { selection } = self

    self.on("keypress", (ch, key) => {
      const selectionRange = selection.getRange().copy()
      let binding = self.resolveBinding(key)
      if (
        self.options.multiLine &&
        binding === "indent" &&
        key.full === "tab" &&
        selectionRange.isSingleLine()
      )
        binding = false

      if (
        binding &&
        ["go", "select", "delete"].some((action) => {
          if (binding.indexOf(action) === 0) {
            if (action !== "go") selection.plantTail()
            const directionDistance = binding.slice(action.length)
            return [
              { name: "All" },
              { name: "MatchingBracket" },
              { name: "Left", axis: "horizontal", direction: -1 },
              { name: "Right", axis: "horizontal", direction: 1 },
              { name: "Up", axis: "vertical", direction: -1 },
              { name: "Down", axis: "vertical", direction: 1 },
            ].some((direction) => {
              if (directionDistance.indexOf(direction.name) === 0) {
                let moved = true
                const startSelectionHead = selection.getHeadPosition()

                if (direction.name === "All") {
                  selection.setRange(self.textBuf.getRange())
                } else if (direction.name === "MatchingBracket") {
                  const matchingBracket = self.matchingBracket()
                  if (matchingBracket)
                    selection.setHeadPosition(matchingBracket)
                  else moved = false
                } else {
                  // } else if ('direction' in direction) {
                  const selectionDirection = -(
                    !selection.getRange().isEmpty() &&
                    selection.isReversed() * 2 - 1
                  )
                  if (
                    !(
                      action === "delete" &&
                      (selectionDirection || self.readOnly())
                    )
                  ) {
                    const distance = directionDistance.slice(
                      direction.name.length
                    )
                    switch (direction.axis) {
                      case "horizontal":
                        switch (distance) {
                          case "":
                            if (
                              action === "go" &&
                              direction.direction === -selectionDirection
                            ) {
                              selection.setHeadPosition(
                                selection.getTailPosition()
                              )
                            } else {
                              self.moveCursorHorizontal(direction.direction)
                            }
                            break
                          case "Word":
                            self.moveCursorHorizontal(direction.direction, true)
                            break
                          case "Infinity":
                            var cursor = selection.getHeadPosition()
                            var firstNonWhiteSpaceX = (self
                              .lineWithEndingForRow(cursor.row)
                              .match(/^\s*/) || [""])[0].length
                            selection.setHeadPosition(
                              new Point(
                                cursor.row,
                                direction.direction === -1
                                  ? cursor.column === firstNonWhiteSpaceX
                                    ? 0
                                    : firstNonWhiteSpaceX
                                  : Infinity
                              )
                            )
                            break
                          default:
                            moved = false
                            break
                        }
                        break
                      case "vertical":
                        switch (distance) {
                          case "":
                            self.moveCursorVertical(direction.direction)
                            break
                          case "Paragraph":
                            self.moveCursorVertical(direction.direction, true)
                            break
                          case "Page":
                            self.moveCursorVertical(
                              direction.direction * self.options.pageLines
                            )
                            break
                          case "Infinity":
                            selection.setHeadPosition(
                              direction.direction === -1
                                ? new Point(0, 0)
                                : new Point(Infinity, Infinity)
                            )
                            break
                          default:
                            moved = false
                            break
                        }
                    }
                  }
                }
                if (moved) {
                  if (action === "go") selection.clearTail()
                  if (action === "delete" && !self.readOnly()) self.delete()
                  return true
                }
              }
            })
          }
        })
      ) {
        return false
      }
      switch (binding) {
        case "selectLine":
        case "deleteLine":
          var cursor = selection.getHeadPosition()
          selection.setRange(
            new Range(
              cursor.row === self.textBuf.getLineCount() - 1
                ? new Point(cursor.row - 1, Infinity)
                : new Point(cursor.row, 0),
              new Point(cursor.row + 1, 0)
            )
          )
          if (binding === "deleteLine") self.delete()
          selection.setHeadPosition(cursor)
          return false
        case "indent":
        case "dedent":
          if (!self.options.multiLine) return
          self.indent(selectionRange, binding === "dedent")
          return false
        case "duplicateLine":
          var cursor = selection.getHeadPosition()
          var line = self.lineWithEndingForRow(cursor.row)
          if (line === self.textBuf.lineForRow(cursor.row)) line = `\n${line}`
          var nextLinePos = new Point(cursor.row + 1, 0)
          self.textBuf.setTextInRange(new Range(nextLinePos, nextLinePos), line)
          return false
        case "undo":
          self.textBuf.undo()
          return false
        case "redo":
          self.textBuf.redo()
          return false
        case "copy":
        case "cut":
          self.copy().done()
          if (binding === "cut") self.delete()
          return false
        case "paste":
          self.paste().done()
          return false
        case "toggleInsertMode":
          self.toggleInsertMode()
          return false
        default:
          if (!binding && !key.ctrl && ch) {
            const enterPressed =
              key.name === "return" || key.name === "linefeed"
            var cursor = selection.getHeadPosition()
            var line = self.lineWithEndingForRow(cursor.row)
            if (enterPressed) {
              if (!self.options.multiLine) return
              ch = `\n${line.slice(0, cursor.column).match(/^( |\t)*/)[0]}`
            } else if (key.name === "enter") {
              return // blessed remaps keys -- ch and key.sequence here are '\r'
            } else if (ch === "\t") {
              ch = self._getTabString()
            } else if (ch === "\x1b") {
              // escape
              return
            }

            if (!self.readOnly()) {
              if (
                selectionRange.isEmpty() &&
                !self.insertMode() &&
                !enterPressed
              )
                selectionRange.end.column++
              if (!selectionRange.isEmpty() && "[({`'\"".indexOf(ch) !== -1) {
                switch (ch) {
                  case "[":
                    var str = "]"
                    break
                  case "(":
                    var str = ")"
                    break
                  case "{":
                    var str = "}"
                    break
                  default:
                    var str = ch
                }
                str = ch + self.textBuf.getTextInRange(selectionRange) + str
                selection.setRange(
                  self.textBuf.setTextInRange(selectionRange, str)
                )
              } else
                selection.setRange(
                  self.textBuf.setTextInRange(selectionRange, ch)
                )
              selection.reversed = false
              selection.clearTail()
            }
            return false
          }
          break
      }
    })

    self.on("mouse", (mouseData) => {
      process.nextTick(() => {
        self._lastMouseData = mouseData
      })
      if (mouseData.action === "wheeldown" || mouseData.action === "wheelup") {
        self.scroll.row +=
          {
            wheelup: -1,
            wheeldown: 1,
          }[mouseData.action] * self.options.pageLines
        self.clipScroll()
        return
      }

      const mouse = self.realPos(
        new Point(mouseData.y, mouseData.x)
          .translate(self.buffer.pos().negate())
          .translate(self.scroll)
      )

      const newSelection = selection.copy()
      if (mouseData.action === "mouseup")
        self.data.lastClick = { mouse, time: Date.now() }
      if (mouseData.action === "mousedown") {
        const { lastClick } = self.data
        if (
          lastClick &&
          mouse.isEqual(lastClick.mouse) &&
          lastClick.time + self.options.doubleClickDuration > Date.now()
        ) {
          self.data.lastClick = null
          const line = self.textBuf.lineForRow(mouse.row)
          let startX = mouse.column
          let endX = mouse.column + 1
          var prev = prev(line, mouse.column)
          var current = current(line, mouse.column)
          if (current) {
            if (prev && current.index < prev.index + prev[0].length) {
              startX = prev.index
              endX = prev.index + prev[0].length
            } else if (
              current.index <= mouse.column &&
              mouse.column < current.index + current[0].length
            ) {
              startX = current.index
              endX = current.index + current[0].length
            }
          }
          newSelection.setRange(
            new Range(new Point(mouse.row, startX), new Point(mouse.row, endX))
          )
        } else {
          if (
            (self._lastMouseData || {}).action !== "mousedown" &&
            !mouseData.shift
          )
            newSelection.clearTail()
          newSelection.setHeadPosition(mouse)
          newSelection.plantTail()
        }
      }
      selection.setRange(newSelection.getRange(), {
        reversed: newSelection.isReversed(),
      })
      newSelection.destroy()
    })

    self.textBuf.onDidChangePath(() => {
      self.language(extname(self.textBuf.getPath()).slice(1))
    })

    selection.onDidChange(() => {
      const cursor = self.visiblePos(selection.getHeadPosition())
      if (self.data.updatePreferredX) self.data.preferredCursorX = cursor.column // preferred X when moving vertically
      self._markMatches()
      self.clipScroll([cursor])
    })

    self.textBuf.onDidChange(() => {
      self._updateContent()
    })

    self.on("detach", () => {
      self.textBuf.destroy()
    })

    return BaseWidget.prototype._initHandlers.apply(self, arguments)
  }
  _updateCursor() {
    const self = this
    if (!self.visible) {
      self.screen.program.hideCursor()
      return
    }
    const scrollCursor = self
      .visiblePos(self.selection.getHeadPosition())
      .translate(self.scroll.negate())
    if (
      new Range(
        new Point(0, 0),
        self.buffer.size().translate(new Point(-1, -1))
      ).containsPoint(scrollCursor) &&
      self === self.screen.focused
    ) {
      const screenCursor = scrollCursor.translate(self.buffer.pos())
      self.screen.program.move(screenCursor.column, screenCursor.row)
      self.screen.program.showCursor()
    } else {
      self.screen.program.hideCursor()
    }
  }
  destroyMarkers(params) {
    const self = this
    self.textBuf.findMarkers(params).forEach((marker) => {
      marker.destroy()
    })
    return self
  }
  _renderableTabString(match) {
    return !this.buffer.options.visibleWhiteSpace
      ? _.repeat(" ", this.buffer.options.tabSize * match.length)
      : util.markup(
          _.repeat(
            _.repeat("\u2500", this.buffer.options.tabSize - 1) +
              (this.buffer.options.tabSize ? "\u2574" : ""),
            match.length
          ),
          this.options.style.whiteSpace
        )
  }
  _renderableSpace(match) {
    return !this.buffer.options.visibleWhiteSpace
      ? match
      : util.markup(
          _.repeat("\u00b7", match.length),
          this.options.style.whiteSpace
        )
  }
  _renderableLineEnding(lineEnding) {
    return !this.buffer.options.visibleLineEndings
      ? ""
      : util.markup(
          lineEnding.replace(/\n/g, "\\n").replace(/\r/g, "\\r"),
          this.options.style.whiteSpace
        )
  }
  static parseCoordinate(n) {
    return parseInt(n, 10) - 1 || 0
  }
  static markerCmp(a, b) {
    return (
      Editor.MARKER_ORDER.indexOf(b.properties.type) -
      Editor.MARKER_ORDER.indexOf(a.properties.type)
    )
  }
}
Editor.prototype.__proto__ = BaseWidget.prototype

Editor.prototype.open = Promise.method(function (givenPath) {
  // Handles nonexistent paths
  const self = this
  return self.ready // ensures textBuf path-changed is triggered in _initHandlers
    .then(() => {
      return Editor.getOpenParams(givenPath)
    })
    .tap((params) => {
      return self.textBuf.setPath(params.path)
    })
    .tap((params) => {
      if (params.exists) return self.textBuf.load()
    })
    .tap((params) => {
      self.selection.setHeadPosition(params.position)
    })
    .tap((params) => {
      /**
       * gets the extension of the file and highlights
       * whats in the text buffer when we open the editor
       */
      const path = self.textBuf.getPath()
      const ext = extname(path).slice(1)
      self.language(ext)
    })
    .return(self)
})
Editor.prototype.save = Promise.method(function (path) {
  const self = this
  const args = arguments
  return Promise.try(() => {
    return path
      ? self.textBuf.saveAs(util.resolvePath.apply(null, args))
      : self.textBuf.save()
  }).then(() => {
    return self.textBuf.getPath()
  })
})

// looks for path like /home/dan/file.c:3:8 but matches every string
Editor.openRegExp = new RegExp(
  "^" +
    "(.*?)" + // path:   match[1] (like /home/dan/file.c)
    "(?:\\:(\\d+))?" + // row:    match[2] (like 3, optional)
    "(?:\\:(\\d+))?" + // column: match[3] (like 8, optional)
    "$"
)
Editor.getOpenParams = Promise.method((givenPath) => {
  givenPath = util.resolvePath(givenPath)
  const baseParams = {
    path: givenPath,
    exists: false,
    position: new Point(0, 0),
  }
  const match = givenPath.match(Editor.openRegExp) // always matches
  return [
    // if a path like file.c:3:8 is passed, see if `file.c:3:8` exists first,
    // then try `file.c:3` line 8, then `file.c` line 3 column 8
    baseParams,
    _.merge({}, baseParams, {
      path: `${match[1]}:${match[2]}`,
      position: { row: Editor.parseCoordinate(match[3]) },
    }),
    _.merge({}, baseParams, {
      path: match[1],
      position: {
        row: Editor.parseCoordinate(match[2]),
        column: Editor.parseCoordinate(match[3]),
      },
    }),
  ].reduce((promise, params) => {
    return promise.then((resultParams) => {
      if ((resultParams || {}).exists) return resultParams
      return Editor.exists(params.path).then((exists) => {
        params.exists = exists
        return params
      })
    })
  }, Promise.resolve())
})

Editor.exists = Promise.method((givenPath) => {
  return fsp
    .openAsync(givenPath, "r")
    .then((fd) => {
      return fsp.closeAsync(fd)
    })
    .return(true)
    .catch((err) => {
      if (err.code !== "ENOENT") throw err
      return false
    })
})

Editor.prototype.insertMode = util.getterSetter("insertMode", null, Boolean)

Editor.prototype.language = util.getterSetter("language", null, null)
Editor.prototype.readOnly = util.getterSetter("readOnly", null, Boolean)

Editor._tabRegExp = /\t/g

Editor.prototype.copy = Promise.method(function () {
  const self = this
  const text = self.textBuf.getTextInRange(self.selection.getRange())
  if (!text) return self
  self.screen.data.clipboard = text
  self.screen.copyToClipboard(text)
  return clipboard
    .copyAsync(text)
    .catch((err) => {
      util.logger.warn("Editor#copy", err)
    })
    .tap(() => {
      util.logger.debug(`copied ${text.length} characters`)
    })
    .return(self)
})
Editor.prototype.paste = Promise.method(function () {
  const self = this
  return clipboard
    .pasteAsync()
    .catch((err) => {
      util.logger.warn("Editor#paste", err)
    })
    .then((text) => {
      text = text || self.screen.data.clipboard
      if (typeof text === "string") {
        self.textBuf.setTextInRange(self.selection.getRange(), text)
        self.selection.reversed = false
        self.selection.clearTail()
        util.logger.debug(`pasted ${text.length} characters`)
      }
      return self
    })
})

Editor._bracketsRegExp = /((\()|(\[)|(\{))|((\))|(\])|(\}))/

Editor.count = 0
// eslint-disable-next-line no-control-regex
Editor._nonprintableRegExp = /[\x00-\x1f]|\x7f/g

Editor.MARKER_ORDER = ["syntax", "match", "findMatch", "selection"]
Editor.prototype._updateContent = function () {
  const self = this

  const size = self.buffer.size()
  const { scroll } = self
  const selectionRange = self.selection.getRange()
  const matchingBracket = self.matchingBracket(self.selection.getHeadPosition())
  const cursorOnBracket =
    selectionRange.isEmpty() && matchingBracket !== undefined
  const visibleSelection = self.visiblePos(selectionRange)
  const visibleCursor =
    visibleSelection[selectionRange.reversed ? "start" : "end"]
  const visibleMatchingBracket =
    selectionRange.isEmpty() &&
    matchingBracket &&
    self.visiblePos(matchingBracket)

  const { style } = self.options
  const defaultStyle = style.default
  const selectionStyle = style.selection
  const matchStyle = style.match
  const bracketStyle =
    matchingBracket && matchingBracket.match
      ? style.matchingBracket
      : style.mismatchedBracket

  const gutterWidth = self.gutter.width
  const lineNumberWidth = self.gutter.options.lineNumberWidth || 0
  const currentLineStyle = self.gutter.options.style.currentLine

  const bufferContent = []
  const gutterContent = []

  util.text
    .splitLines(
      BaseWidget.blessed.escape(
        self.textBuf.getTextInRange({
          start: new Point(scroll.row, 0),
          end: scroll.translate(size),
        })
      )
    )
    .forEach((line, row) => {
      const { column } = scroll
      row += scroll.row

      const renderableLineEnding = self._renderableLineEnding(
        (line.match(util.text._lineRegExp) || [""])[0]
      )
      line = line
        .replace(/\t+/g, self._renderableTabString.bind(self))
        .replace(/ +/g, self._renderableSpace.bind(self))
        .replace(util.text._lineRegExp, renderableLineEnding)
        .replace(Editor._nonprintableRegExp, "\ufffd")

      line = util.markup
        .parse(line)
        .slice(column, column + size.column)
        .push(_.repeat(" ", size.column))
        .tag(defaultStyle)

      self.textBuf
        .findMarkers({ intersectsRow: row })
        .sort(Editor.markerCmp)
        .forEach((marker) => {
          const range = self.visiblePos(marker.getRange())
          if (range.intersectsRow(row)) {
            let markerStyle
            switch (marker.properties.type) {
              case "selection":
                markerStyle = selectionStyle
                break
              case "match":
              case "findMatch":
                markerStyle = matchStyle
                break
              case "syntax":
                markerStyle = marker.properties.syntax
                  .map((syntax) => {
                    if (!(syntax in style))
                      util.logger.debug("unstyled syntax:", syntax)
                    return style[syntax] || ""
                  })
                  .join("")
                break
              default:
                throw new Error(`unknown marker: ${marker.properties.type}`)
            }
            line = util.markup(
              line,
              markerStyle,
              row === range.start.row ? range.start.column - column : 0,
              row === range.end.row ? range.end.column - column : Infinity
            )
          }
        })

      if (cursorOnBracket && row === visibleCursor.row) {
        line = util.markup(
          line,
          bracketStyle,
          visibleCursor.column - column,
          visibleCursor.column - column + 1
        )
      }
      if (visibleMatchingBracket && row === visibleMatchingBracket.row) {
        line = util.markup(
          line,
          bracketStyle,
          visibleMatchingBracket.column - column,
          visibleMatchingBracket.column - column + 1
        )
      }

      bufferContent.push(`${line}{/}`)

      let gutterLine =
        padStart(row + 1, lineNumberWidth) + _.repeat(" ", gutterWidth)

      if (currentLineStyle && row === visibleCursor.row) {
        gutterLine = util.markup(gutterLine, currentLineStyle)
      }

      gutterContent.push(`${gutterLine}{/}`)
    })

  self.buffer.setContent(bufferContent.join("\n"))
  self.gutter.setContent(gutterContent.join("\n"))
  self.screen.render()
}

Editor.Field = Field

export default Editor
