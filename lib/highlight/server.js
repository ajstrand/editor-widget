#!/usr/bin/env node

import hljs from "highlight.js"

hljs.configure({ classPrefix: "" })
import cheerio from "cheerio"
import util from "slap-util"

function highlight(text, language) {
  if (language === false) return []

  let highlighted
  if (language) {
    try {
      highlighted = hljs.highlight(language, text, true)
    } catch (e) {
      console.error(`there was an error highlighting ${text} with ${language}`)
      console.error(e)
    }
  }
  if (!highlighted) highlighted = hljs.highlightAuto(text)

  const $ = cheerio.load(highlighted.value)
  const ranges = []
  do {
    var lastElCount = elCount
    var elCount = $("*:not(:has(*))").replaceWith(function () {
      const $el = $(this)
      let text = ""
      ;[this]
        .concat($el.parents().get(), [$.root()])
        .reverse()
        .reduce((parent, el) => {
          $(parent)
            .contents()
            .each(function () {
              const $sibling = $(this)
              if ($sibling.is(el)) return false
              text += $sibling.text()
            })
          return el
        })
      const lines = util.text.splitLines(text)
      const linesPlusEl = util.text.splitLines(text + $el.text())
      ranges.push({
        range: [
          [lines.length - 1, lines[lines.length - 1].length],
          [linesPlusEl.length - 1, linesPlusEl[linesPlusEl.length - 1].length],
        ],
        properties: {
          type: "syntax",
          syntax: ($el.attr("class") || "").match(/\S+/g) || [],
        },
      })
      return $el.text()
    }).length
  } while (lastElCount !== elCount)

  return ranges
}

process.on("message", (message) => {
  switch (message.type) {
    case "highlight":
      process.send({
        ranges: highlight(message.text, message.language),
        revision: message.revision,
        bucket: message.bucket,
      })
      break
    case "logger":
      util.logger(message.options)
      break
  }
})
