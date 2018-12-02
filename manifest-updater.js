const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const dir = __dirname
const manifest = require(path.join(dir, 'manifest.json'))

Object.keys(manifest.files).forEach(file => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')
  if (typeof manifest.files[file] === 'object')
    manifest.files[file].hash = hash
  else
    manifest.files[file] = hash
})

fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')