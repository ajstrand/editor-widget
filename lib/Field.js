import _ from "lodash"
import editorWidgetOpts from "./opts.js"
import Editor from "./Editor.js"

class Field {
  constructor(opts) {
    const self = this

    if (!(self instanceof Field)) return new Field(opts)

    self.options = {
      ...self,
      ..._.merge(
        {
          height: 1,
          multiLine: false,
        },
        editorWidgetOpts.field,
        opts
      ),
    }

    self.language(false)
  }
  //Field.prototype.__proto__ = Editor.prototype;
  submit(value) {
    this.emit("submit", value)
  }
  cancel() {
    this.emit("cancel")
  }
  _initHandlers() {
    const self = this
    self.on("keypress", (ch, key) => {
      switch (self.resolveBinding(key)) {
        case "submit":
          self.submit(self.textBuf.getText())
          return false
        case "cancel":
          self.cancel()
          return false
      }
    })
    return Editor.prototype._initHandlers.apply(self, arguments)
  }
}

export default Field
