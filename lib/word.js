//var word = /[^\s.\(\){}\[\]]+/g
const word = /\w+/g

export { prev, next, current, wordEnd }

function prev(string, i, r) {
  r = r || word
  r.lastIndex = 0
  r.global = true

  let _m = null,
    m = null
  do {
    _m = m
    m = r.exec(string)
  } while (m && m.index < i)

  if (!m || m.index >= i) return _m
  return m
}

function next(string, i, r) {
  r = r || word
  r.lastIndex = i
  r.global = true

  let _m = null,
    m = null
  do {
    m = r.exec(string)
    if (!m) return _m
    _m = m
  } while (m && m.index > i)

  return r.exec(string)
}

function current(string, i, r) {
  r = r || word
  r.lastIndex = i
  r.global = true
  let m
  do {
    m = r.exec(string)
    if (!m) return null
    //take the first match ends after this position.
    //console.error(m, i, '<', m.index + m[0].length)
    if (i < m.index + m[0].length) return m
  } while (m)
}

function wordEnd(string, i, r) {
  const m = current(string, i, r)
  return m && m.index + m[0].length
}
