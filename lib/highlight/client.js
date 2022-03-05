import { fork } from "child_process"
import path from "path"
import Promise from "bluebird"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)

const __dirname = path.dirname(__filename)

const init = Promise.resolve()
// var opts = minimist(process.execArgv);
const forkOpts = { silent: false }
// if (['inspect', 'inspect-brk'].some(function (opt) { return opt in opts; })) {
// init = init
//   .then(require('get-random-port'))
//   .then(function (port) { forkOpts.execArgv = ['--inspect=' + port]; })
//   .return(null);
// }

function spawn() {
  return (spawn.promise = spawn.promise.then((client) => {
    if (client && client.dontRespawn) return client.kill()
    const oldMessageListeners = client ? client.listeners("message") : []
    client = fork(path.join(__dirname, "server.js"), forkOpts)
    client.setMaxListeners(100)
    client.on("exit", spawn)
    oldMessageListeners.forEach(client.on.bind(client, "message"))
    return client
  }))
}
spawn.promise = init

spawn.buckets = 0
spawn.getBucket = function () {
  return spawn.buckets++
}

export default spawn
