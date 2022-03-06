import _ from "lodash"
import editorWidgetOpts from "./opts.js"
import Editor from "./Editor.js"

class Field {
  constructor(opts) {
    let self = this

    // eslint-disable-next-line no-constructor-return
    if (!(self instanceof Field)) return new Field(opts)

    self = {
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

    //self.language(false)
  }
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
//Field.prototype.__proto__ = Editor.prototype

export default Field
